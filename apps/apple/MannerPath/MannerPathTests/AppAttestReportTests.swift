import Foundation
import Testing
@testable import MannerPath

private final class AppAttestVectorBundleAnchor {}

private struct ClientDataVectors: Decodable {
    struct Case: Decodable {
        let name: String
        let domain: String
        let challengeBase64: String
        let keyIdBase64: String
        let payloadBase64: String?
        let clientDataHex: String
        let clientDataHashHex: String
        let clientDataHashBase64: String
    }

    let contract: String
    let version: Int
    let cases: [Case]

    static func load() throws -> Self {
        let bundle = Bundle(for: AppAttestVectorBundleAnchor.self)
        let url = try #require(bundle.url(forResource: "client-data-vectors.v1", withExtension: "json"))
        return try JSONDecoder().decode(Self.self, from: Data(contentsOf: url))
    }
}

private extension Data {
    var hex: String { map { String(format: "%02x", $0) }.joined() }
}

// MARK: - Test doubles

private actor FakeAppAttestDevice: AppAttestDevice {
    nonisolated let isSupported: Bool
    private var keys: [String] = []
    private var attested: Set<String> = []
    private(set) var generatedKeyCount = 0
    private(set) var assertionHashes: [Data] = []
    private(set) var attestationHashes: [Data] = []
    private(set) var attestationKeyIDs: [String] = []
    var nextKeyIDs: [String]
    var generateKeyError: AppAttestDeviceError?
    var attestError: AppAttestDeviceError?
    var assertionError: AppAttestDeviceError?
    /// Keys whose Secure Enclave material is gone: any use answers invalidKey.
    var deadKeys: Set<String> = []

    init(isSupported: Bool = true, keyIDs: [String] = [FakeAppAttestDevice.keyID(1), FakeAppAttestDevice.keyID(2)]) {
        self.isSupported = isSupported
        nextKeyIDs = keyIDs
    }

    static func keyID(_ seed: UInt8) -> String {
        Data(repeating: seed, count: 32).base64EncodedString()
    }

    func set(generateKeyError: AppAttestDeviceError?) { self.generateKeyError = generateKeyError }
    func set(attestError: AppAttestDeviceError?) { self.attestError = attestError }
    func set(assertionError: AppAttestDeviceError?) { self.assertionError = assertionError }
    func kill(_ keyId: String) { deadKeys.insert(keyId) }

    func generateKey() async throws -> String {
        if let generateKeyError { throw generateKeyError }
        generatedKeyCount += 1
        let keyId = nextKeyIDs.isEmpty ? Self.keyID(UInt8(9 + generatedKeyCount)) : nextKeyIDs.removeFirst()
        keys.append(keyId)
        return keyId
    }

    func attestKey(_ keyId: String, clientDataHash: Data) async throws -> Data {
        // Recorded before any failure, so a test can prove a retry used the identical hash.
        attestationHashes.append(clientDataHash)
        attestationKeyIDs.append(keyId)
        if let attestError { throw attestError }
        guard keys.contains(keyId), !attested.contains(keyId), !deadKeys.contains(keyId) else {
            throw AppAttestDeviceError.invalidKey // Apple refuses to attest a key twice.
        }
        attested.insert(keyId)
        // The real attestation object embeds the nonce over this exact clientDataHash; the fake
        // server checks that binding, so no test can certify an impossible registration.
        return Data("attestation|\(keyId)|\(clientDataHash.base64EncodedString())".utf8)
    }

    func generateAssertion(_ keyId: String, clientDataHash: Data) async throws -> Data {
        if let assertionError { throw assertionError }
        guard attested.contains(keyId), !deadKeys.contains(keyId) else { throw AppAttestDeviceError.invalidKey }
        assertionHashes.append(clientDataHash)
        return Data("assertion-\(assertionHashes.count)".utf8)
    }

    func counts() -> (generated: Int, assertions: Int) { (generatedKeyCount, assertionHashes.count) }
}

private struct RegistrationCall: Equatable, Sendable {
    let keyId: String
    let challenge: String
    let attestationObject: Data
}

private actor FakeAppAttestServer: AppAttestServer {
    private(set) var challengeRequests: [AppAttestChallengePurpose] = []
    private(set) var registrations: [RegistrationCall] = []
    private var issued = 0
    var registrationChallengeError: Error?
    var reportChallengeError: Error?
    var registrationResults: [Result<Void, Error>] = []
    var registeredKeys: Set<String> = []

    func set(reportChallengeError: Error?) { self.reportChallengeError = reportChallengeError }
    func set(registrationChallengeError: Error?) { self.registrationChallengeError = registrationChallengeError }
    func set(registrationResults: [Result<Void, Error>]) { self.registrationResults = registrationResults }

    func requestChallenge(_ purpose: AppAttestChallengePurpose) async throws -> String {
        challengeRequests.append(purpose)
        switch purpose {
        case .registration: if let registrationChallengeError { throw registrationChallengeError }
        case .report: if let reportChallengeError { throw reportChallengeError }
        }
        issued += 1
        var bytes = Data(repeating: 0, count: 32)
        bytes[0] = UInt8(issued)
        return bytes.base64EncodedString()
    }

    /// Mirrors the server's order of checks: the challenge is consumed, an already-registered key
    /// answers 409 before any verification, and only then is the attestation verified against the
    /// nonce it was built over (docs/API.md POST /app-attest/keys).
    func registerKey(keyId: String, challenge: String, attestationObject: Data) async throws {
        registrations.append(RegistrationCall(keyId: keyId, challenge: challenge, attestationObject: attestationObject))
        if !registrationResults.isEmpty {
            switch registrationResults.removeFirst() {
            case .success: break
            case .failure(let error): throw error
            }
        }
        if registeredKeys.contains(keyId) { return } // 409 keyAlreadyRegistered: usable as is.
        guard let challengeBytes = Data(base64Encoded: challenge), let keyBytes = Data(base64Encoded: keyId) else {
            throw ReportAPIError.rejected(400, "invalidKeyRegistration")
        }
        let expected = AppAttestBinding.registrationClientDataHash(challenge: challengeBytes, keyId: keyBytes)
        let bound = "attestation|\(keyId)|\(expected.base64EncodedString())"
        guard String(decoding: attestationObject, as: UTF8.self) == bound else {
            throw ReportAPIError.attestationRejected(.init(reason: .attestationInvalid, detail: "nonceMismatch"))
        }
        registeredKeys.insert(keyId)
    }

    /// Marks a key as stored server-side without the client having seen the answer.
    func pretendStored(_ keyId: String) { registeredKeys.insert(keyId) }

    func challenges() -> [AppAttestChallengePurpose] { challengeRequests }
    func registrationCalls() -> [RegistrationCall] { registrations }
}

private final class MemoryKeyStore: AppAttestKeyStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var state: AppAttestKeyState?
    private(set) var saves: [AppAttestKeyState] = []

    init(_ state: AppAttestKeyState? = nil) { self.state = state }
    func load() throws -> AppAttestKeyState? { lock.withLock { state } }
    func save(_ state: AppAttestKeyState) throws { lock.withLock { self.state = state; saves.append(state) } }
    func clear() throws { lock.withLock { state = nil } }
    var current: AppAttestKeyState? { lock.withLock { state } }
}

private struct StubAuthorizer: ReportAuthorizing {
    var supported = true
    var result: Result<ReportAuthorization, ReportAuthorizationError> = .success(
        ReportAuthorization(keyId: FakeAppAttestDevice.keyID(1), challenge: Data(repeating: 7, count: 32).base64EncodedString(),
                            assertion: Data("assertion".utf8)))
    func isSupported() async -> Bool { supported }
    func authorize(payload: Data) async throws -> ReportAuthorization { try result.get() }
    func handleRejection(_ rejection: AttestationRejection, keyId: String) async {}
}

private actor RecordingAttestedSubmitter: AttestedReportSubmitting {
    private(set) var envelopes: [Data] = []
    var results: [Result<AcceptedReport, Error>]
    init(results: [Result<AcceptedReport, Error>]) { self.results = results }
    func submitAttested(_ envelope: Data) async throws -> AcceptedReport {
        envelopes.append(envelope)
        return try (results.isEmpty ? .failure(URLError(.networkConnectionLost)) : results.removeFirst()).get()
    }
    func sent() -> [Data] { envelopes }
}

private struct UnusedSubmitter: ReportSubmitting {
    func submit(_ body: Data) async throws -> AcceptedReport {
        Issue.record("The unattested endpoint must not be used by an App Attest deployment")
        throw ReportAPIError.httpStatus(500)
    }
}

private struct StaticAvailability: ReportConfigFetching {
    let value: ReportAvailability
    func fetchAvailability() async throws -> ReportAvailability { value }
}

private struct FixedInstall: InstallIDProviding {
    func installID() -> UUID { UUID(uuidString: "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f")! }
}

private actor MockTransport: ReportHTTPTransport {
    var responses: [ReportHTTPResponse]
    private(set) var requests: [URLRequest] = []
    init(_ responses: [ReportHTTPResponse]) { self.responses = responses }
    func send(_ request: URLRequest) async throws -> ReportHTTPResponse {
        requests.append(request)
        return responses.removeFirst()
    }
    func sent() -> [URLRequest] { requests }
}

private func makeAuthorizer(device: FakeAppAttestDevice, server: FakeAppAttestServer,
                            store: MemoryKeyStore) -> AppAttestReportAuthorizer {
    AppAttestReportAuthorizer(device: device, server: server, store: store)
}

private let appAttestLimits = ReportLimits(noteMaxLength: 280, maxBodyBytes: 4096,
                                           submissionProtocol: .appAttest, maxSubmissionBytes: 8192)
private let receiptV2 = AcceptedReport(schemaVersion: 2, reportId: "rp_01V64NN31G72E5KJJ5W22W1A1J",
                                       state: "pending", receivedAt: "2026-09-20T09:30:00Z")

// MARK: - Binding

struct AppAttestBindingContractTests {
    @Test func committedCrossLanguageVectorsMatchByteForByte() throws {
        let vectors = try ClientDataVectors.load()
        #expect(vectors.contract == "mannerpath-app-attest-client-data-vectors")
        #expect(vectors.version == 1)
        #expect(vectors.cases.count >= 5)
        for vector in vectors.cases {
            let challenge = try #require(Data(base64Encoded: vector.challengeBase64))
            let keyId = try #require(Data(base64Encoded: vector.keyIdBase64))
            let payload = try vector.payloadBase64.map { try #require(Data(base64Encoded: $0)) }
            let clientData = AppAttestBinding.clientData(domain: vector.domain,
                                                         parts: [challenge, keyId] + (payload.map { [$0] } ?? []))
            #expect(clientData.hex == vector.clientDataHex, "clientData for \(vector.name)")
            let hash = payload.map {
                AppAttestBinding.reportClientDataHash(challenge: challenge, keyId: keyId, payload: $0)
            } ?? AppAttestBinding.registrationClientDataHash(challenge: challenge, keyId: keyId)
            #expect(hash.hex == vector.clientDataHashHex, "clientDataHash for \(vector.name)")
            #expect(hash.base64EncodedString() == vector.clientDataHashBase64)
        }
    }

    @Test func publishedReportVectorAndItsReorderedAlternateDiffer() throws {
        let vectors = try ClientDataVectors.load()
        let published = try #require(vectors.cases.first { $0.name == "report exists" })
        let reordered = try #require(vectors.cases.first { $0.name == "report exists, keys reordered" })
        #expect(published.clientDataHashHex == "7ac2808aefe7c61d09d8486d9ea0ec308aa1abe7cff7f86dd3c8cd88fbcb2805")
        let challenge = try #require(Data(base64Encoded: published.challengeBase64))
        let keyId = try #require(Data(base64Encoded: published.keyIdBase64))
        let bytes = try #require(Data(base64Encoded: published.payloadBase64 ?? ""))
        let alternate = try #require(Data(base64Encoded: reordered.payloadBase64 ?? ""))
        let hash = AppAttestBinding.reportClientDataHash(challenge: challenge, keyId: keyId, payload: bytes)
        let alternateHash = AppAttestBinding.reportClientDataHash(challenge: challenge, keyId: keyId, payload: alternate)
        #expect(hash.hex == published.clientDataHashHex)
        #expect(alternateHash.hex == reordered.clientDataHashHex)
        #expect(hash != alternateHash)
    }

    @Test func framingIsLengthPrefixedAndDomainSeparated() throws {
        let challenge = Data(repeating: 1, count: 32)
        let keyId = Data(repeating: 2, count: 32)
        let payload = Data("x".utf8)
        let framed = AppAttestBinding.clientData(domain: "ab", parts: [payload])
        #expect(framed.hex == "000000026162" + "00000001" + "78")
        #expect(AppAttestBinding.registrationClientDataHash(challenge: challenge, keyId: keyId)
                != AppAttestBinding.reportClientDataHash(challenge: challenge, keyId: keyId, payload: Data()))
        // One different payload byte is a different hash.
        #expect(AppAttestBinding.reportClientDataHash(challenge: challenge, keyId: keyId, payload: payload)
                != AppAttestBinding.reportClientDataHash(challenge: challenge, keyId: keyId, payload: Data("y".utf8)))
    }
}

// MARK: - Registration and assertion

struct AppAttestAuthorizerTests {
    let payload = Data(#"{"schemaVersion":2,"type":"exists","spotId":"sp_1","installId":"i"}"#.utf8)

    @Test func firstUseGeneratesKeyRegistersItAndBindsTheRegistrationChallenge() async throws {
        let device = FakeAppAttestDevice()
        let server = FakeAppAttestServer()
        let store = MemoryKeyStore()
        let authorization = try await makeAuthorizer(device: device, server: server, store: store)
            .authorize(payload: payload)

        let challenges = await server.challenges()
        #expect(challenges.count == 2)
        #expect(challenges.first == .registration)
        let registrations = await server.registrationCalls()
        #expect(registrations.count == 1)
        #expect(registrations[0].keyId == FakeAppAttestDevice.keyID(1))
        // The attestKey hash is the frozen registration binding over that challenge and key ID.
        let registrationChallenge = try #require(Data(base64Encoded: registrations[0].challenge))
        let keyBytes = try #require(Data(base64Encoded: registrations[0].keyId))
        let attestHashes = await device.attestationHashes
        #expect(attestHashes == [AppAttestBinding.registrationClientDataHash(challenge: registrationChallenge, keyId: keyBytes)])
        // The assertion hash is the frozen report binding over the report challenge and payload.
        let reportChallenge = try #require(Data(base64Encoded: authorization.challenge))
        let assertionHashes = await device.assertionHashes
        #expect(assertionHashes == [AppAttestBinding.reportClientDataHash(challenge: reportChallenge, keyId: keyBytes, payload: payload)])
        #expect(store.current == .registered(keyId: FakeAppAttestDevice.keyID(1)))
    }

    @Test func registeredKeyIsReusedWithoutGeneratingAnotherAndChallengesAreNotReused() async throws {
        let device = FakeAppAttestDevice()
        let server = FakeAppAttestServer()
        let store = MemoryKeyStore()
        let authorizer = makeAuthorizer(device: device, server: server, store: store)
        let first = try await authorizer.authorize(payload: payload)
        let second = try await authorizer.authorize(payload: payload)

        #expect(first.keyId == second.keyId)
        #expect(first.challenge != second.challenge)
        #expect(first.assertion != second.assertion)
        let counts = await device.counts()
        #expect(counts.generated == 1)
        #expect(counts.assertions == 2)
        #expect(await server.registrationCalls().count == 1)
    }

    @Test func unsupportedDeviceNeverAttemptsAnything() async throws {
        let device = FakeAppAttestDevice(isSupported: false)
        let server = FakeAppAttestServer()
        let authorizer = makeAuthorizer(device: device, server: server, store: MemoryKeyStore())
        #expect(await authorizer.isSupported() == false)
        await #expect(throws: ReportAuthorizationError.unsupported) { try await authorizer.authorize(payload: payload) }
        #expect(await server.challenges().isEmpty)
        #expect(await device.counts().generated == 0)
    }

    @Test func ambiguousRegistrationReconcilesWithKeyAlreadyRegistered() async throws {
        let device = FakeAppAttestDevice()
        let server = FakeAppAttestServer()
        let store = MemoryKeyStore()
        // The 201 was lost: the transport failed after the server stored the key.
        await server.set(registrationResults: [.failure(URLError(.networkConnectionLost))])
        let authorizer = makeAuthorizer(device: device, server: server, store: store)
        await #expect(throws: ReportAuthorizationError.temporarilyUnavailable) {
            try await authorizer.authorize(payload: payload)
        }
        guard case .attested(let attestedKeyID, _) = try #require(store.current) else {
            Issue.record("An unanswered registration must keep the attested key")
            return
        }
        #expect(attestedKeyID == FakeAppAttestDevice.keyID(1))
        await server.pretendStored(attestedKeyID)

        // A later attempt re-presents the SAME attestation with a NEW challenge. The server holds
        // the key, so it answers 409 before verifying the (now unbindable) attestation.
        _ = try await authorizer.authorize(payload: payload)
        let registrations = await server.registrationCalls()
        #expect(registrations.count == 2)
        #expect(registrations[0].keyId == registrations[1].keyId)
        #expect(registrations[0].attestationObject == registrations[1].attestationObject)
        #expect(registrations[0].challenge != registrations[1].challenge)
        #expect(await device.counts().generated == 1) // no unnecessary key generation
        #expect(store.current == .registered(keyId: FakeAppAttestDevice.keyID(1)))
    }

    @Test func definiteRegistrationChallengeInvalidDiscardsTheSpentAttestation() async throws {
        let device = FakeAppAttestDevice()
        let server = FakeAppAttestServer()
        let store = MemoryKeyStore()
        await server.set(registrationResults: [
            .failure(ReportAPIError.attestationRejected(.init(reason: .challengeInvalid, detail: "challenge expired")))
        ])
        let authorizer = makeAuthorizer(device: device, server: server, store: store)
        await #expect(throws: ReportAuthorizationError.registrationFailed) {
            try await authorizer.authorize(payload: payload)
        }
        // Definite: the key was not registered, and the attestation object is bound to the
        // challenge it was made over, so it can never satisfy a different one. The key is spent.
        #expect(store.current == nil)
        #expect(await server.registrationCalls().count == 1)
        #expect(await device.counts().generated == 1)

        // A later explicit attempt starts from a brand new key rather than reusing the old object.
        _ = try await authorizer.authorize(payload: payload)
        let registrations = await server.registrationCalls()
        #expect(registrations.count == 2)
        #expect(registrations[0].keyId != registrations[1].keyId)
        #expect(registrations[0].attestationObject != registrations[1].attestationObject)
        #expect(store.current == .registered(keyId: FakeAppAttestDevice.keyID(2)))
    }

    @Test func reconcilingAKeyTheServerNeverStoredDiscardsItAndRegistersAReplacement() async throws {
        let device = FakeAppAttestDevice()
        let server = FakeAppAttestServer()
        let store = MemoryKeyStore()
        // The registration POST was lost before it reached the server: nothing was stored.
        await server.set(registrationResults: [.failure(URLError(.timedOut))])
        let authorizer = makeAuthorizer(device: device, server: server, store: store)
        await #expect(throws: ReportAuthorizationError.temporarilyUnavailable) {
            try await authorizer.authorize(payload: payload)
        }
        // Reconciliation under a new challenge cannot verify (nonceMismatch), so the key goes and
        // exactly one replacement is registered.
        let authorization = try await authorizer.authorize(payload: payload)
        #expect(authorization.keyId == FakeAppAttestDevice.keyID(2))
        #expect(await device.counts().generated == 2)
        #expect(store.current == .registered(keyId: FakeAppAttestDevice.keyID(2)))
    }

    @Test func keyNotRegisteredAtChallengeRecoversWithANewKeyExactlyOnce() async throws {
        let device = FakeAppAttestDevice()
        let server = FakeAppAttestServer()
        let store = MemoryKeyStore(.registered(keyId: FakeAppAttestDevice.keyID(5)))
        await server.set(reportChallengeError: ReportAPIError.attestationRejected(
            .init(reason: .keyNotRegistered, detail: nil)))
        let authorizer = makeAuthorizer(device: device, server: server, store: store)
        await #expect(throws: ReportAuthorizationError.registrationFailed) {
            try await authorizer.authorize(payload: payload)
        }
        // Bounded: one replacement key, then it stops rather than looping.
        #expect(await device.counts().generated == 1)
    }

    @Test func aDeadSecureEnclaveKeyIsReplacedOnceAndNotReattested() async throws {
        let device = FakeAppAttestDevice()
        let server = FakeAppAttestServer()
        let store = MemoryKeyStore()
        let authorizer = makeAuthorizer(device: device, server: server, store: store)
        _ = try await authorizer.authorize(payload: payload)
        await device.kill(FakeAppAttestDevice.keyID(1)) // e.g. restored from a backup
        let recovered = try await authorizer.authorize(payload: payload)
        #expect(recovered.keyId == FakeAppAttestDevice.keyID(2))
        #expect(await device.counts().generated == 2)
        #expect(store.current == .registered(keyId: FakeAppAttestDevice.keyID(2)))
    }

    @Test func appleServerUnavailableRetriesWithTheSameKeyAndTheSameClientDataHash() async throws {
        let device = FakeAppAttestDevice()
        let server = FakeAppAttestServer()
        let store = MemoryKeyStore()
        await device.set(attestError: .serverUnavailable)
        let authorizer = makeAuthorizer(device: device, server: server, store: store)
        await #expect(throws: ReportAuthorizationError.temporarilyUnavailable) {
            try await authorizer.authorize(payload: payload)
        }
        // The challenge taken before attestKey is persisted, so the exact binding can be repeated.
        guard case .prepared(let keyId, let challenge) = try #require(store.current) else {
            Issue.record("serverUnavailable must keep the prepared registration binding")
            return
        }
        #expect(keyId == FakeAppAttestDevice.keyID(1))

        await device.set(attestError: nil)
        _ = try await authorizer.authorize(payload: payload)

        // Apple requires the retry to use the same key AND the same client data hash.
        let hashes = await device.attestationHashes
        let keyIDs = await device.attestationKeyIDs
        #expect(hashes.count == 2)
        #expect(hashes[0] == hashes[1])
        #expect(keyIDs == [FakeAppAttestDevice.keyID(1), FakeAppAttestDevice.keyID(1)])
        let challengeBytes = try #require(Data(base64Encoded: challenge))
        let keyBytes = try #require(Data(base64Encoded: keyId))
        #expect(hashes[0] == AppAttestBinding.registrationClientDataHash(challenge: challengeBytes, keyId: keyBytes))
        // No second registration challenge was taken before that retry.
        let registrationChallenges = await server.challenges().filter { $0 == .registration }
        #expect(registrationChallenges.count == 1)
        #expect(await device.counts().generated == 1)
        #expect(store.current == .registered(keyId: FakeAppAttestDevice.keyID(1)))
    }

    @Test func challengeLimitedAndServiceUnavailableSurfaceWithoutKeyChurn() async throws {
        for (thrown, expected) in [
            (ReportAPIError.challengeLimited(300), ReportAuthorizationError.challengeLimited(300)),
            (ReportAPIError.rejected(503, "attestationUnavailable"), ReportAuthorizationError.serviceUnavailable)
        ] {
            let device = FakeAppAttestDevice()
            let server = FakeAppAttestServer()
            let store = MemoryKeyStore()
            await server.set(registrationChallengeError: thrown)
            await #expect(throws: expected) {
                try await makeAuthorizer(device: device, server: server, store: store).authorize(payload: payload)
            }
            #expect(await server.registrationCalls().isEmpty)
        }
    }

    @Test func bundleVersionRejectionAsksForAnUpdateAndDiscardsTheKey() async throws {
        let device = FakeAppAttestDevice()
        let server = FakeAppAttestServer()
        let store = MemoryKeyStore()
        await server.set(registrationResults: [
            .failure(ReportAPIError.attestationRejected(.init(reason: .attestationInvalid, detail: "bundleVersion")))
        ])
        await #expect(throws: ReportAuthorizationError.updateRequired) {
            try await makeAuthorizer(device: device, server: server, store: store).authorize(payload: payload)
        }
        #expect(store.current == nil)
    }

    @Test @MainActor func anAuthorizationFailureNeverLeavesTheModelBusyOrMarksAnAttempt() async throws {
        for error in [ReportAuthorizationError.unsupported, .serviceUnavailable, .updateRequired,
                      .registrationFailed, .temporarilyUnavailable] {
            var authorizer = StubAuthorizer()
            authorizer.result = .failure(error)
            let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
            let store = FileReportDraftStore(directory: directory)
            let submitter = RecordingAttestedSubmitter(results: [])
            let model = ReportModel(configClient: StaticAvailability(value: .available(appAttestLimits)),
                                    reportClient: UnusedSubmitter(), store: store, installIDs: FixedInstall(),
                                    attestedClient: submitter, authorizer: authorizer)
            await model.refreshAvailability()
            model.start(type: .exists, spotId: "sp_01V64NN31G72E5KJJ5W22W1A1J")
            await model.submit()
            #expect(!model.isBusy, "\(error) must not leave the model preparing")
            #expect(try store.submissionMarker() == nil, "\(error) sent no report")
            #expect(try store.load() != nil)
            #expect(await submitter.sent().isEmpty)
        }
    }

    @Test func rejectionPolicyAppliesOnlyToDefiniteKeyFailures() async throws {
        let keyId = FakeAppAttestDevice.keyID(1)
        for reason in [AttestationRejection.Reason.challengeInvalid, .counterNotIncreasing] {
            let store = MemoryKeyStore(.registered(keyId: keyId))
            let authorizer = makeAuthorizer(device: FakeAppAttestDevice(), server: FakeAppAttestServer(), store: store)
            await authorizer.handleRejection(.init(reason: reason, detail: nil), keyId: keyId)
            #expect(store.current == .registered(keyId: keyId))
        }
        for reason in [AttestationRejection.Reason.keyNotRegistered, .assertionInvalid] {
            let store = MemoryKeyStore(.registered(keyId: keyId))
            let authorizer = makeAuthorizer(device: FakeAppAttestDevice(), server: FakeAppAttestServer(), store: store)
            await authorizer.handleRejection(.init(reason: reason, detail: "malformed"), keyId: keyId)
            #expect(store.current == nil)
        }
        // `detail: bundleVersion` is about the build, not the key: the key stays registered and is
        // usable again once the user updates the app.
        let bundleStore = MemoryKeyStore(.registered(keyId: keyId))
        let bundleAuthorizer = makeAuthorizer(device: FakeAppAttestDevice(), server: FakeAppAttestServer(),
                                              store: bundleStore)
        await bundleAuthorizer.handleRejection(.init(reason: .assertionInvalid, detail: "bundleVersion"),
                                               keyId: keyId)
        #expect(bundleStore.current == .registered(keyId: keyId))
        // A rejection naming another key never touches the current one.
        let store = MemoryKeyStore(.registered(keyId: keyId))
        let authorizer = makeAuthorizer(device: FakeAppAttestDevice(), server: FakeAppAttestServer(), store: store)
        await authorizer.handleRejection(.init(reason: .assertionInvalid, detail: nil),
                                         keyId: FakeAppAttestDevice.keyID(2))
        #expect(store.current == .registered(keyId: keyId))
    }

    @Test func keyIdentifierIsNeitherTheInstallIdNorPartOfTheReport() async throws {
        let device = FakeAppAttestDevice()
        let server = FakeAppAttestServer()
        let store = MemoryKeyStore()
        let draft = ReportDraft(type: .exists, spotId: "sp_01V64NN31G72E5KJJ5W22W1A1J")
        let payload = try ReportRequest.encoded(draft: draft, installId: FixedInstall().installID(), limits: appAttestLimits)
        let authorization = try await makeAuthorizer(device: device, server: server, store: store).authorize(payload: payload)
        let json = String(decoding: payload, as: UTF8.self)
        // The install identifier (the server accepts either hex case) and nothing else identifying.
        #expect(json.localizedCaseInsensitiveContains("8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f"))
        #expect(!json.contains(authorization.keyId))
        #expect(!json.contains(authorization.challenge))
    }
}

// MARK: - Config, submission and duplicate safety

struct AppAttestReportFlowTests {
    let existsDraft = ReportDraft(type: .exists, spotId: "sp_01V64NN31G72E5KJJ5W22W1A1J")

    private func model(availability: ReportAvailability,
                       authorizer: any ReportAuthorizing,
                       submitter: RecordingAttestedSubmitter,
                       store: any ReportDraftStoring) -> ReportModel {
        ReportModel(configClient: StaticAvailability(value: availability), reportClient: UnusedSubmitter(),
                    store: store, installIDs: FixedInstall(),
                    attestedClient: submitter, authorizer: authorizer)
    }

    private func tempStore() -> FileReportDraftStore {
        FileReportDraftStore(directory: FileManager.default.temporaryDirectory.appending(path: UUID().uuidString))
    }

    @Test func configChoosesTheProtocolAndRefusesUnsupportedRanges() async throws {
        func availability(_ body: String) async throws -> ReportAvailability {
            try await ReportAPIClient(baseURL: URL(string: "https://example.test")!,
                                      transport: MockTransport([ReportHTTPResponse(statusCode: 200, body: Data(body.utf8), retryAfter: nil)]))
                .fetchAvailability()
        }
        let v1 = #"{"schemaVersion":1,"apiVersion":"v1","schemaVersions":{"report":1},"minimumSupportedSchemaVersions":{"report":1},"reports":{"available":true,"attestation":"none","maxBodyBytes":4096,"maxSubmissionBytes":4096,"noteMaxLength":280}}"#
        #expect(try await availability(v1) == .available(ReportLimits(noteMaxLength: 280, maxBodyBytes: 4096,
                                                                      submissionProtocol: .unattested, maxSubmissionBytes: 4096)))
        let v2 = #"{"schemaVersion":1,"apiVersion":"v1","schemaVersions":{"report":2},"minimumSupportedSchemaVersions":{"report":2},"reports":{"available":true,"attestation":"appAttest","maxBodyBytes":4096,"maxSubmissionBytes":8192,"noteMaxLength":280}}"#
        #expect(try await availability(v2) == .available(appAttestLimits))
        let unavailable = #"{"schemaVersion":1,"apiVersion":"v1","schemaVersions":{"report":2},"minimumSupportedSchemaVersions":{"report":2},"reports":{"available":false,"attestation":"appAttest","maxBodyBytes":4096,"maxSubmissionBytes":8192,"noteMaxLength":280}}"#
        #expect(try await availability(unavailable) == .unavailable)
        // An unknown protocol, or a version range this build cannot speak, is never guessed at.
        let unknownProtocol = #"{"schemaVersion":1,"apiVersion":"v1","schemaVersions":{"report":3},"minimumSupportedSchemaVersions":{"report":3},"reports":{"available":true,"attestation":"somethingElse","maxBodyBytes":4096,"maxSubmissionBytes":8192,"noteMaxLength":280}}"#
        #expect(try await availability(unknownProtocol) == .incompatible)
        let mismatched = #"{"schemaVersion":1,"apiVersion":"v1","schemaVersions":{"report":1},"minimumSupportedSchemaVersions":{"report":1},"reports":{"available":true,"attestation":"appAttest","maxBodyBytes":4096,"maxSubmissionBytes":8192,"noteMaxLength":280}}"#
        #expect(try await availability(mismatched) == .incompatible)
    }

    @Test @MainActor func appAttestDeploymentOnAnUnsupportedDeviceIsUnavailableNotDowngraded() async throws {
        var authorizer = StubAuthorizer()
        authorizer.supported = false
        let submitter = RecordingAttestedSubmitter(results: [])
        let model = model(availability: .available(appAttestLimits), authorizer: authorizer,
                          submitter: submitter, store: tempStore())
        await model.refreshAvailability()
        #expect(model.availability == .attestationUnsupported)
        model.start(type: .exists, spotId: "sp_1")
        await model.submit()
        #expect(await submitter.sent().isEmpty)
        // A failure before any POST leaves the draft editable, never stuck "preparing".
        #expect(!model.isBusy)
        #expect(model.draft != nil)
    }

    @Test @MainActor func unavailableConfigDisablesSubmission() async throws {
        let submitter = RecordingAttestedSubmitter(results: [])
        let model = model(availability: .unavailable, authorizer: StubAuthorizer(), submitter: submitter, store: tempStore())
        await model.refreshAvailability()
        #expect(model.availability == .unavailable)
        model.start(type: .exists, spotId: "sp_1")
        await model.submit()
        #expect(await submitter.sent().isEmpty)
    }

    @Test @MainActor func acceptedSubmissionSendsTheExactSignedBytesAndCleansUp() async throws {
        let device = FakeAppAttestDevice()
        let server = FakeAppAttestServer()
        let authorizer = makeAuthorizer(device: device, server: server, store: MemoryKeyStore())
        let submitter = RecordingAttestedSubmitter(results: [.success(receiptV2)])
        let store = tempStore()
        let model = model(availability: .available(appAttestLimits), authorizer: authorizer,
                          submitter: submitter, store: store)
        await model.refreshAvailability()
        model.start(type: .exists, spotId: existsDraft.spotId)
        await model.submit()

        #expect(model.submission == .accepted(receiptV2))
        #expect(model.draft == nil)
        #expect(try store.load() == nil)
        #expect(try store.submissionMarker() == nil)

        let envelope = try #require(await submitter.sent().first)
        let object = try #require(JSONSerialization.jsonObject(with: envelope) as? [String: Any])
        #expect(Set(object.keys) == ["schemaVersion", "payload", "attestation"])
        #expect(object["schemaVersion"] as? Int == 2)
        let payloadText = try #require(object["payload"] as? String)
        let payloadBytes = try #require(Data(base64Encoded: payloadText))
        let attestation = try #require(object["attestation"] as? [String: String])
        #expect(Set(attestation.keys) == ["keyId", "challenge", "assertion"])
        // The signed bytes are exactly the bytes transported: the hash the device signed is the
        // report binding over this very payload.
        let hashes = await device.assertionHashes
        let challenge = try #require(Data(base64Encoded: attestation["challenge"]!))
        let keyId = try #require(Data(base64Encoded: attestation["keyId"]!))
        #expect(hashes == [AppAttestBinding.reportClientDataHash(challenge: challenge, keyId: keyId, payload: payloadBytes)])
        let report = try #require(JSONSerialization.jsonObject(with: payloadBytes) as? [String: Any])
        #expect(report["schemaVersion"] as? Int == 2)
        #expect(Set(report.keys) == ["schemaVersion", "type", "spotId", "installId"])
    }

    @Test @MainActor func ambiguousFinalPostKeepsTheDraftAndNeverResendsByItself() async throws {
        let device = FakeAppAttestDevice()
        let authorizer = makeAuthorizer(device: device, server: FakeAppAttestServer(), store: MemoryKeyStore())
        let submitter = RecordingAttestedSubmitter(results: [.failure(URLError(.networkConnectionLost))])
        let store = tempStore()
        let model = model(availability: .available(appAttestLimits), authorizer: authorizer,
                          submitter: submitter, store: store)
        await model.refreshAvailability()
        model.start(type: .exists, spotId: existsDraft.spotId)
        await model.submit()

        #expect(model.submission == .ambiguous)
        #expect(model.draft != nil)
        #expect(try store.load() != nil)
        #expect(try store.submissionMarker() == .attempted)
        // An ordinary submit must not fetch a new challenge or send anything.
        await model.submit()
        #expect(await submitter.sent().count == 1)
        #expect(await device.counts().assertions == 1)
    }

    @Test @MainActor func explicitDuplicateAwareRetrySignsAgainWithFreshAuthorization() async throws {
        let device = FakeAppAttestDevice()
        let server = FakeAppAttestServer()
        let authorizer = makeAuthorizer(device: device, server: server, store: MemoryKeyStore())
        let submitter = RecordingAttestedSubmitter(results: [.failure(URLError(.networkConnectionLost)), .success(receiptV2)])
        let model = model(availability: .available(appAttestLimits), authorizer: authorizer,
                          submitter: submitter, store: tempStore())
        await model.refreshAvailability()
        model.start(type: .exists, spotId: existsDraft.spotId)
        await model.submit()
        #expect(model.canRetryAmbiguous)
        await model.retryAmbiguous()
        #expect(model.submission == .accepted(receiptV2))
        let envelopes = await submitter.sent()
        #expect(envelopes.count == 2)
        // A new challenge and a new assertion: neither is ever reused.
        let first = try #require(JSONSerialization.jsonObject(with: envelopes[0]) as? [String: Any])
        let second = try #require(JSONSerialization.jsonObject(with: envelopes[1]) as? [String: Any])
        let firstAttestation = first["attestation"] as? [String: String]
        let secondAttestation = second["attestation"] as? [String: String]
        #expect(firstAttestation?["challenge"] != secondAttestation?["challenge"])
        #expect(firstAttestation?["assertion"] != secondAttestation?["assertion"])
        // The same report re-encoded is not necessarily the same bytes — Foundation does not
        // promise a key order — so each envelope must carry the exact bytes its own assertion
        // covers. That is the whole point of encoding once per submission.
        let hashes = await device.assertionHashes
        #expect(hashes.count == 2)
        for (envelope, hash) in zip(envelopes, hashes) {
            let object = try #require(JSONSerialization.jsonObject(with: envelope) as? [String: Any])
            let attestation = try #require(object["attestation"] as? [String: String])
            let payloadText = try #require(object["payload"] as? String)
            let payloadBytes = try #require(Data(base64Encoded: payloadText))
            let challenge = try #require(Data(base64Encoded: attestation["challenge"] ?? ""))
            let keyId = try #require(Data(base64Encoded: attestation["keyId"] ?? ""))
            #expect(hash == AppAttestBinding.reportClientDataHash(challenge: challenge, keyId: keyId,
                                                                  payload: payloadBytes))
        }
        // Both carry the same report, whatever the byte order.
        func report(_ envelope: Data) throws -> [String: String] {
            let object = try #require(JSONSerialization.jsonObject(with: envelope) as? [String: Any])
            let text = try #require(object["payload"] as? String)
            let bytes = try #require(Data(base64Encoded: text))
            let decoded = try #require(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
            return decoded.mapValues { String(describing: $0) }
        }
        #expect(try report(envelopes[0]) == (try report(envelopes[1])))
    }

    @Test @MainActor func definiteAttestationRejectionKeepsTheDraftCorrectableAndRetryable() async throws {
        let device = FakeAppAttestDevice()
        let server = FakeAppAttestServer()
        let authorizer = makeAuthorizer(device: device, server: server, store: MemoryKeyStore())
        let rejection = AttestationRejection(reason: .challengeInvalid, detail: "challenge consumed")
        let submitter = RecordingAttestedSubmitter(results: [.failure(ReportAPIError.attestationRejected(rejection)),
                                                             .success(receiptV2)])
        let store = tempStore()
        let model = model(availability: .available(appAttestLimits), authorizer: authorizer,
                          submitter: submitter, store: store)
        await model.refreshAvailability()
        model.start(type: .exists, spotId: existsDraft.spotId)
        await model.submit()
        if case .authorizationFailed = model.submission {} else { Issue.record("Expected a definite rejection state") }
        #expect(try store.submissionMarker() == nil) // definite: not an ambiguous delivery
        #expect(try store.load() != nil)
        // Submitting again is allowed and produces NEW authorization.
        await model.submit()
        #expect(model.submission == .accepted(receiptV2))
        #expect(await device.counts().assertions == 2)
    }

    @Test @MainActor func bundleVersionAssertionRejectionKeepsTheKeyAndAsksForAnUpdate() async throws {
        let device = FakeAppAttestDevice()
        let server = FakeAppAttestServer()
        let keyStore = MemoryKeyStore()
        let authorizer = makeAuthorizer(device: device, server: server, store: keyStore)
        let rejection = AttestationRejection(reason: .assertionInvalid, detail: "bundleVersion")
        let submitter = RecordingAttestedSubmitter(results: [.failure(ReportAPIError.attestationRejected(rejection))])
        let store = tempStore()
        let model = model(availability: .available(appAttestLimits), authorizer: authorizer,
                          submitter: submitter, store: store)
        await model.refreshAvailability()
        model.start(type: .exists, spotId: existsDraft.spotId)
        await model.submit()

        #expect(model.availability == .incompatible)
        #expect(keyStore.current == .registered(keyId: FakeAppAttestDevice.keyID(1)))
        #expect(model.draft != nil)
        #expect(try store.load() != nil)
        #expect(try store.submissionMarker() == nil) // definite: nothing was stored server-side
        // Another tap cannot submit, so it cannot churn a replacement key either.
        await model.submit()
        #expect(await submitter.sent().count == 1)
        #expect(await device.counts().generated == 1)
    }

    @Test @MainActor func nonBundleVersionAssertionRejectionRecoversWithANewKey() async throws {
        let device = FakeAppAttestDevice()
        let server = FakeAppAttestServer()
        let keyStore = MemoryKeyStore()
        let authorizer = makeAuthorizer(device: device, server: server, store: keyStore)
        let rejection = AttestationRejection(reason: .assertionInvalid, detail: "signature")
        let submitter = RecordingAttestedSubmitter(results: [.failure(ReportAPIError.attestationRejected(rejection)),
                                                             .success(receiptV2)])
        let model = model(availability: .available(appAttestLimits), authorizer: authorizer,
                          submitter: submitter, store: tempStore())
        await model.refreshAvailability()
        model.start(type: .exists, spotId: existsDraft.spotId)
        await model.submit()

        if case .authorizationFailed = model.submission {} else { Issue.record("Expected a definite rejection") }
        #expect(model.availability == .available(appAttestLimits)) // still reportable
        #expect(keyStore.current == nil) // the documented key-unusable recovery
        await model.submit()
        #expect(model.submission == .accepted(receiptV2))
        #expect(keyStore.current == .registered(keyId: FakeAppAttestDevice.keyID(2)))
        #expect(await device.counts().generated == 2)
    }

    @Test @MainActor func challengeAndCounterRejectionsKeepTheRegisteredKey() async throws {
        for reason in [AttestationRejection.Reason.challengeInvalid, .counterNotIncreasing] {
            let device = FakeAppAttestDevice()
            let keyStore = MemoryKeyStore()
            let authorizer = makeAuthorizer(device: device, server: FakeAppAttestServer(), store: keyStore)
            let submitter = RecordingAttestedSubmitter(results: [
                .failure(ReportAPIError.attestationRejected(.init(reason: reason, detail: "d"))),
                .success(receiptV2)
            ])
            let model = model(availability: .available(appAttestLimits), authorizer: authorizer,
                              submitter: submitter, store: tempStore())
            await model.refreshAvailability()
            model.start(type: .exists, spotId: existsDraft.spotId)
            await model.submit()
            #expect(keyStore.current == .registered(keyId: FakeAppAttestDevice.keyID(1)), "\(reason)")
            // A new challenge and a new assertion on the same key resolve it.
            await model.submit()
            #expect(model.submission == .accepted(receiptV2), "\(reason)")
            #expect(await device.counts().generated == 1, "\(reason)")
        }
    }

    @Test @MainActor func challengeLimitAndReportRateLimitBothBlockImmediateRetries() async throws {
        let submitter = RecordingAttestedSubmitter(results: [.failure(ReportAPIError.rateLimited(61))])
        var limited = StubAuthorizer()
        limited.result = .failure(.challengeLimited(300))
        let challengeModel = model(availability: .available(appAttestLimits), authorizer: limited,
                                   submitter: RecordingAttestedSubmitter(results: []), store: tempStore())
        await challengeModel.refreshAvailability()
        challengeModel.start(type: .exists, spotId: existsDraft.spotId)
        await challengeModel.submit()
        #expect(challengeModel.submission == .rateLimited(300))
        #expect((challengeModel.retryAfterSecondsRemaining ?? 0) > 0)

        let rateLimited = model(availability: .available(appAttestLimits), authorizer: StubAuthorizer(),
                                submitter: submitter, store: tempStore())
        await rateLimited.refreshAvailability()
        rateLimited.start(type: .exists, spotId: existsDraft.spotId)
        await rateLimited.submit()
        #expect(rateLimited.submission == .rateLimited(61))
        await rateLimited.submit()
        #expect(await submitter.sent().count == 1)
    }

    @Test @MainActor func noAttestationMaterialIsEverWrittenToTheDraft() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let store = FileReportDraftStore(directory: directory)
        let device = FakeAppAttestDevice()
        let authorizer = makeAuthorizer(device: device, server: FakeAppAttestServer(), store: MemoryKeyStore())
        let submitter = RecordingAttestedSubmitter(results: [.failure(URLError(.timedOut))])
        let model = model(availability: .available(appAttestLimits), authorizer: authorizer,
                          submitter: submitter, store: store)
        await model.refreshAvailability()
        model.start(type: .exists, spotId: existsDraft.spotId)
        await model.submit()
        #expect(model.submission == .ambiguous)
        let saved = try Data(contentsOf: store.fileURL)
        let text = String(decoding: saved, as: UTF8.self)
        for forbidden in ["assertion", "challenge", "attestation", "keyId"] {
            #expect(!text.localizedCaseInsensitiveContains(forbidden), "draft must not persist \(forbidden)")
        }
        let object = try #require(JSONSerialization.jsonObject(with: saved) as? [String: Any])
        #expect(Set(object.keys) == ["type", "spotId"])
    }

    @Test func attestedSubmissionClassifiesServerAnswers() async throws {
        let accepted = #"{"schemaVersion":2,"reportId":"rp_01V64NN31G72E5KJJ5W22W1A1J","state":"pending","receivedAt":"2026-09-20T09:30:00Z"}"#
        let client = { (status: Int, body: String, retryAfter: String?) in
            ReportAPIClient(baseURL: URL(string: "https://example.test")!,
                            transport: MockTransport([ReportHTTPResponse(statusCode: status, body: Data(body.utf8), retryAfter: retryAfter)]))
        }
        #expect(try await client(201, accepted, nil).submitAttested(Data()).reportId == "rp_01V64NN31G72E5KJJ5W22W1A1J")
        // A v1 receipt from a v2 submission is not proof of anything.
        await #expect(throws: ReportAPIError.incompatibleResponse) {
            try await client(201, accepted.replacingOccurrences(of: "\"schemaVersion\":2", with: "\"schemaVersion\":1"), nil).submitAttested(Data())
        }
        for reason in AttestationRejection.Reason.allRawValues {
            let body = #"{"error":"attestationRejected","reason":"\#(reason)","detail":"d"}"#
            await #expect(throws: ReportAPIError.attestationRejected(
                .init(reason: .init(rawValue: reason)!, detail: "d"))) {
                try await client(403, body, nil).submitAttested(Data())
            }
        }
        // An unknown 403 shape is not treated as a proven pre-store refusal.
        await #expect(throws: ReportAPIError.incompatibleResponse) {
            try await client(403, #"{"error":"attestationRejected","reason":"newReason"}"#, nil).submitAttested(Data())
        }
        await #expect(throws: ReportAPIError.rateLimited(61)) {
            try await client(429, #"{"error":"reportRateLimited"}"#, "61").submitAttested(Data())
        }
        await #expect(throws: ReportAPIError.rejected(400, "reportSchemaUnsupported")) {
            try await client(400, #"{"error":"reportSchemaUnsupported"}"#, nil).submitAttested(Data())
        }
    }

    @Test func challengeAndRegistrationRequestsFollowTheWireContract() async throws {
        let challengeBody = #"{"schemaVersion":1,"challenge":"AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=","purpose":"report","expiresAt":"2026-09-21T09:35:00Z"}"#
        let transport = MockTransport([ReportHTTPResponse(statusCode: 201, body: Data(challengeBody.utf8), retryAfter: nil),
                                       ReportHTTPResponse(statusCode: 201, body: Data(#"{"schemaVersion":1,"keyId":"zgSY9YSD+7TaDXssY6WlOPVS1K3Lmk+pFhlcSWE+ZV0=","registeredAt":"2026-09-21T09:30:00Z"}"#.utf8), retryAfter: nil)])
        let client = ReportAPIClient(baseURL: URL(string: "https://example.test")!, transport: transport)
        let keyId = "zgSY9YSD+7TaDXssY6WlOPVS1K3Lmk+pFhlcSWE+ZV0="
        #expect(try await client.requestChallenge(.report(keyId: keyId)) == "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=")
        try await client.registerKey(keyId: keyId, challenge: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
                                     attestationObject: Data([1, 2, 3]))
        let requests = await transport.sent()
        #expect(requests.map { $0.url?.path } == ["/v1/app-attest/challenges", "/v1/app-attest/keys"])
        let challengeBodySent = try #require(requests[0].httpBody)
        let challengeRequest = try #require(JSONSerialization.jsonObject(with: challengeBodySent) as? [String: Any])
        #expect(challengeRequest["schemaVersion"] as? Int == 1)
        #expect(challengeRequest["purpose"] as? String == "report")
        #expect(challengeRequest["keyId"] as? String == keyId)
        let keyBodySent = try #require(requests[1].httpBody)
        let keyRequest = try #require(JSONSerialization.jsonObject(with: keyBodySent) as? [String: Any])
        #expect(Set(keyRequest.keys) == ["schemaVersion", "keyId", "challenge", "attestationObject"])
        #expect(keyRequest["attestationObject"] as? String == Data([1, 2, 3]).base64EncodedString())
    }

    @Test func alreadyRegisteredAndLimitedAnswersAreMappedForRecovery() async throws {
        let client = { (status: Int, body: String, retryAfter: String?) in
            ReportAPIClient(baseURL: URL(string: "https://example.test")!,
                            transport: MockTransport([ReportHTTPResponse(statusCode: status, body: Data(body.utf8), retryAfter: retryAfter)]))
        }
        // 409 is success: this exact key is usable as is.
        try await client(409, #"{"error":"keyAlreadyRegistered","detail":"d"}"#, nil)
            .registerKey(keyId: "k", challenge: "c", attestationObject: Data())
        await #expect(throws: ReportAPIError.challengeLimited(300)) {
            _ = try await client(429, #"{"error":"challengeLimited","detail":"d"}"#, "300").requestChallenge(.registration)
        }
        await #expect(throws: ReportAPIError.rejected(503, "attestationUnavailable")) {
            _ = try await client(503, #"{"error":"attestationUnavailable","detail":"d"}"#, nil).requestChallenge(.registration)
        }
        await #expect(throws: ReportAPIError.attestationRejected(.init(reason: .keyNotRegistered, detail: "d"))) {
            _ = try await client(403, #"{"error":"attestationRejected","reason":"keyNotRegistered","detail":"d"}"#, nil)
                .requestChallenge(.report(keyId: "k"))
        }
    }

    @Test func keyStateSurvivesRoundTripOnDiskAndIsRemovable() throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let store = FileAppAttestKeyStore(directory: directory)
        #expect(try store.load() == nil)
        try store.save(.attested(keyId: "k", attestationObject: Data([9])))
        #expect(try store.load() == .attested(keyId: "k", attestationObject: Data([9])))
        try store.save(.registered(keyId: "k"))
        #expect(try store.load() == .registered(keyId: "k"))
        try store.clear()
        #expect(try store.load() == nil)
    }
}

private extension AttestationRejection.Reason {
    static var allRawValues: [String] {
        ["challengeInvalid", "keyNotRegistered", "attestationInvalid", "assertionInvalid", "counterNotIncreasing"]
    }
}
