import Foundation
import Testing
@testable import MannerPath

private actor V3Transport: ReportHTTPTransport {
    private var responses: [ReportHTTPResponse]
    private var bodies: [Data] = []
    init(_ responses: [ReportHTTPResponse]) { self.responses = responses }
    func send(_ request: URLRequest) async throws -> ReportHTTPResponse {
        bodies.append(request.httpBody ?? Data())
        return responses.removeFirst()
    }
    func count() -> Int { bodies.count }
}

private struct V3Config: ReportConfigFetching {
    let limits: ReportLimits
    func fetchAvailability() async throws -> ReportAvailability { .available(limits) }
}

private struct V3InstallID: InstallIDProviding {
    func installID() -> UUID { UUID(uuidString: "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f")! }
}

private actor V3Authorizer: ReportAuthorizing {
    private var payloads: [Data] = []
    func isSupported() -> Bool { true }
    func authorize(payload: Data) -> ReportAuthorization {
        payloads.append(payload)
        return ReportAuthorization(keyId: Data(repeating: 9, count: 32).base64EncodedString(),
                                   challenge: Data(repeating: UInt8(payloads.count), count: 32).base64EncodedString(),
                                   assertion: Data([UInt8(payloads.count)]))
    }
    func handleRejection(_ rejection: AttestationRejection, keyId: String) {}
    func signedPayloads() -> [Data] { payloads }
}

private actor V3Submitter: ReportSubmitting, AttestedReportSubmitting {
    private var results: [Result<AcceptedReport, Error>]
    private var bodies: [Data] = []
    init(_ results: [Result<AcceptedReport, Error>]) { self.results = results }
    func submit(_ body: Data) async throws -> AcceptedReport {
        Issue.record("v3 must never downgrade to unattested submission")
        throw ReportAPIError.incompatibleResponse
    }
    func submitAttested(_ envelope: Data) async throws -> AcceptedReport {
        bodies.append(envelope)
        return try results.removeFirst().get()
    }
    func envelopes() -> [Data] { bodies }
}

struct ReportV3Tests {
    private let spotID = "sp_01V64NN31G72E5KJJ5W22W1A1J"
    private var limits: ReportLimits {
        ReportLimits(noteMaxLength: 280, maxBodyBytes: 4096,
                     submissionProtocol: .appAttestV3, maxSubmissionBytes: 8192)
    }
    private var receipt: AcceptedReport {
        AcceptedReport(schemaVersion: 3, reportId: "rp_01V64NN31G72E5KJJ5W22W1A1J",
                       state: "pending", receivedAt: "2026-10-13T00:00:00.000Z")
    }
    private func directory() -> URL { FileManager.default.temporaryDirectory.appending(path: UUID().uuidString) }
    private func object(_ data: Data) throws -> [String: Any] {
        try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
    private func envelope() throws -> Data {
        let payload = try ReportRequest.encoded(draft: ReportDraft(type: .exists, spotId: spotID),
                                               installId: V3InstallID().installID(), limits: limits)
        return try AttestedReportEnvelope.encoded(payload: payload,
            authorization: ReportAuthorization(keyId: Data(repeating: 9, count: 32).base64EncodedString(),
                                                challenge: Data(repeating: 1, count: 32).base64EncodedString(),
                                                assertion: Data([1])), schemaVersion: 3)
    }

    @Test func keysArePerDraftRandom32BytesAndOldDraftDoesNotInventOne() throws {
        let drafts = (0..<64).map { _ in ReportDraft(type: .exists, spotId: spotID) }
        let keys = try drafts.map { try #require($0.idempotencyKey) }
        #expect(Set(keys).count == 64)
        #expect(keys.allSatisfy { $0.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil })
        let old = try JSONDecoder().decode(ReportDraft.self, from: Data(#"{"type":"exists","spotId":"sp_123"}"#.utf8))
        #expect(old.idempotencyKey == nil)
        #expect(old.pendingSubmission == nil)
        let roundTrip = try JSONDecoder().decode(ReportDraft.self, from: JSONEncoder().encode(drafts[0]))
        #expect(roundTrip.idempotencyKey == drafts[0].idempotencyKey)
    }

    @Test func v3PayloadHasSignedKeyWhileLegacySchemasOmitIt() throws {
        let draft = ReportDraft(type: .exists, spotId: spotID)
        let v3 = try object(ReportRequest.encoded(draft: draft, installId: V3InstallID().installID(), limits: limits))
        #expect(v3["schemaVersion"] as? Int == 3)
        #expect(v3["idempotencyKey"] as? String == draft.idempotencyKey)
        for version in [ReportProtocol.unattested, .appAttest] {
            var oldLimits = limits
            oldLimits.submissionProtocol = version
            let old = try object(ReportRequest.encoded(draft: draft, installId: V3InstallID().installID(), limits: oldLimits))
            #expect(old["idempotencyKey"] == nil)
            #expect(old["schemaVersion"] as? Int == version.schemaVersion)
        }
    }

    @Test func provisionalServerV3BindingVectorIncludesKey() throws {
        // Copied from the unmerged Server Slice 1 vector, not a declaration of a final protocol.
        let payload = Data(#"{"schemaVersion":3,"type":"exists","spotId":"sp_01V64NN31G72E5KJJ5W22W1A1J","installId":"8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f","idempotencyKey":"202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f"}"#.utf8)
        let challenge = try #require(Data(base64Encoded: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="))
        let key = try #require(Data(base64Encoded: "zgSY9YSD+7TaDXssY6WlOPVS1K3Lmk+pFhlcSWE+ZV0="))
        #expect(AppAttestBinding.reportClientDataHash(challenge: challenge, keyId: key, payload: payload).base64EncodedString()
                == "LAkHDTJsCZAuOAjTQ8tx/nDZdLL4xFLeGE2Y2YV9rDE=")
        let changed = Data(String(decoding: payload, as: UTF8.self).replacingOccurrences(of: "20212223", with: "40414243").utf8)
        #expect(AppAttestBinding.reportClientDataHash(challenge: challenge, keyId: key, payload: changed)
                != AppAttestBinding.reportClientDataHash(challenge: challenge, keyId: key, payload: payload))
    }

    @Test func replay200AndCreated201AcceptOnlyV3ValidReceipt() async throws {
        let body = Data(#"{"schemaVersion":3,"reportId":"rp_01V64NN31G72E5KJJ5W22W1A1J","state":"pending","receivedAt":"2026-10-13T00:00:00.000Z"}"#.utf8)
        for status in [200, 201] {
            let client = ReportAPIClient(baseURL: URL(string: "https://example.test")!,
                transport: V3Transport([.init(statusCode: status, body: body, retryAfter: nil)]), allowsSchemaV3: true)
            #expect(try await client.submitAttested(envelope()) == receipt)
        }
        for (status, code, expected) in [(409, "idempotencyConflict", ReportAPIError.idempotencyConflict),
                                         (410, "idempotencyRetired", ReportAPIError.idempotencyRetired)] {
            let client = ReportAPIClient(baseURL: URL(string: "https://example.test")!,
                transport: V3Transport([.init(statusCode: status, body: Data("{\"error\":\"\(code)\"}".utf8), retryAfter: nil)]),
                allowsSchemaV3: true)
            await #expect(throws: expected) { _ = try await client.submitAttested(envelope()) }
        }
        for body in ["{}", "{\"error\":\"unexpected\"}"] {
            let client = ReportAPIClient(baseURL: URL(string: "https://example.test")!,
                transport: V3Transport([.init(statusCode: 410, body: Data(body.utf8), retryAfter: nil)]), allowsSchemaV3: true)
            await #expect(throws: ReportAPIError.incompatibleResponse) { _ = try await client.submitAttested(envelope()) }
        }
    }

    @Test func configV3RequiresOptInAndNeverDowngradesAmbiguousRanges() async throws {
        for enabled in [false, true] {
            for (minimum, maximum, attestation) in [(1, 1, "none"), (2, 2, "appAttest"),
                                                   (3, 3, "appAttest"), (2, 3, "appAttest"), (3, 3, "none")] {
                let body = Data("{\"schemaVersion\":1,\"apiVersion\":\"v1\",\"schemaVersions\":{\"report\":\(maximum)},\"minimumSupportedSchemaVersions\":{\"report\":\(minimum)},\"reports\":{\"available\":true,\"attestation\":\"\(attestation)\",\"maxBodyBytes\":4096,\"maxSubmissionBytes\":8192,\"noteMaxLength\":280}}".utf8)
                let client = ReportAPIClient(baseURL: URL(string: "https://example.test")!,
                    transport: V3Transport([.init(statusCode: 200, body: body, retryAfter: nil)]), allowsSchemaV3: enabled)
                let availability = try await client.fetchAvailability()
                if minimum == maximum && (minimum < 3 || (enabled && attestation == "appAttest")) {
                    guard case .available(let selected) = availability else { Issue.record("Expected compatible advertised protocol"); continue }
                    #expect(selected.submissionProtocol.schemaVersion == minimum)
                } else {
                    #expect(availability == .incompatible)
                }
            }
        }
    }

    @Test func defaultV3GateRefusesBeforeNetwork() async throws {
        let transport = V3Transport([])
        let client = ReportAPIClient(baseURL: URL(string: "https://example.test")!, transport: transport)
        await #expect(throws: ReportAPIError.incompatibleResponse) { _ = try await client.submitAttested(envelope()) }
        #expect(await transport.count() == 0)
    }

    @Test @MainActor func lostResponseRetryAfterRestartUsesSameBytesAndFreshAuthorizationThenDeletesKey() async throws {
        let path = directory()
        defer { try? FileManager.default.removeItem(at: path) }
        let store = FileReportDraftStore(directory: path)
        let sender = V3Submitter([.failure(URLError(.networkConnectionLost)), .success(receipt)])
        let authorizer = V3Authorizer()
        let first = ReportModel(configClient: V3Config(limits: limits), reportClient: sender,
            store: store, installIDs: V3InstallID(), attestedClient: sender, authorizer: authorizer)
        await first.refreshAvailability()
        first.start(type: .exists, spotId: spotID)
        let key = try #require(first.draft?.idempotencyKey)
        await first.submit()
        #expect(first.submission == .ambiguous)
        let persisted = try #require(try store.load())
        #expect(persisted.idempotencyKey == key)
        #expect(persisted.pendingSubmission?.schemaVersion == 3)
        var edit = persisted
        edit.note = "different payload"
        first.saveDraft(edit)
        #expect(first.draft == persisted, "an ambiguous frozen payload cannot be edited under the same key")
        await first.submit()
        #expect(await sender.envelopes().count == 1, "no automatic resend")
        let restarted = ReportModel(configClient: V3Config(limits: limits), reportClient: sender,
            store: store, installIDs: V3InstallID(), attestedClient: sender, authorizer: authorizer)
        await restarted.refreshAvailability()
        #expect(restarted.canRetryAmbiguous)
        await restarted.submit()
        #expect(await sender.envelopes().count == 1)
        await restarted.retryAmbiguous()
        let signed = await authorizer.signedPayloads()
        #expect(signed.count == 2)
        #expect(signed[0] == signed[1])
        #expect(signed[0] == persisted.pendingSubmission?.payload)
        let requests = await sender.envelopes()
        let one = try object(requests[0]), two = try object(requests[1])
        #expect(one["payload"] as? String == two["payload"] as? String)
        let firstProof = try #require(one["attestation"] as? [String: Any])
        let secondProof = try #require(two["attestation"] as? [String: Any])
        #expect(firstProof["challenge"] as? String != secondProof["challenge"] as? String)
        #expect(firstProof["assertion"] as? String != secondProof["assertion"] as? String)
        #expect(restarted.submission == .accepted(receipt))
        #expect(restarted.draft == nil)
        #expect(try store.load() == nil)
        #expect(try store.submissionMarker() == nil)
        restarted.start(type: .exists, spotId: spotID)
        #expect(restarted.draft?.idempotencyKey != key)
    }

    @Test @MainActor func explicitRetryInSameProcessReusesPayloadAndKey() async throws {
        let path = directory()
        defer { try? FileManager.default.removeItem(at: path) }
        let sender = V3Submitter([.failure(URLError(.timedOut)), .success(receipt)])
        let authorizer = V3Authorizer()
        let model = ReportModel(configClient: V3Config(limits: limits), reportClient: sender,
            store: FileReportDraftStore(directory: path), installIDs: V3InstallID(),
            attestedClient: sender, authorizer: authorizer)
        await model.refreshAvailability()
        model.start(type: .exists, spotId: spotID)
        let key = model.draft?.idempotencyKey
        await model.submit()
        #expect(model.canRetryAmbiguous)
        #expect(model.draft?.idempotencyKey == key)
        await model.retryAmbiguous()
        let signed = await authorizer.signedPayloads()
        #expect(signed.count == 2)
        #expect(signed[0] == signed[1])
        #expect(model.submission == .accepted(receipt))
    }

    @Test @MainActor func conflictAndRetirementPreserveFrozenDraftButCannotRetry() async throws {
        for error in [ReportAPIError.idempotencyConflict, .idempotencyRetired] {
            let path = directory()
            defer { try? FileManager.default.removeItem(at: path) }
            let store = FileReportDraftStore(directory: path)
            let sender = V3Submitter([.failure(error)])
            let model = ReportModel(configClient: V3Config(limits: limits), reportClient: sender,
                store: store, installIDs: V3InstallID(), attestedClient: sender, authorizer: V3Authorizer())
            await model.refreshAvailability()
            model.start(type: .exists, spotId: spotID)
            await model.submit()
            #expect(model.draft?.pendingSubmission != nil)
            #expect(model.submission == (error == .idempotencyConflict ? .idempotencyConflict : .idempotencyRetired))
            #expect(model.draft?.pendingSubmission?.terminalFailure == (error == .idempotencyConflict ? "idempotencyConflict" : "idempotencyRetired"))
            #expect(!model.canRetryAmbiguous)
            await model.submit()
            await model.retryAmbiguous()
            #expect(await sender.envelopes().count == 1)
            let restarted = ReportModel(configClient: V3Config(limits: limits), reportClient: sender,
                store: store, installIDs: V3InstallID(), attestedClient: sender, authorizer: V3Authorizer())
            await restarted.refreshAvailability()
            #expect(restarted.submission == model.submission)
            await restarted.retryAmbiguous()
            await restarted.submit()
            #expect(await sender.envelopes().count == 1, "terminal receipt outcomes survive restart")
        }
    }

    @Test @MainActor func legacyAttemptCannotGainRestartRetryByAdvertisingV3() async throws {
        let path = directory()
        defer { try? FileManager.default.removeItem(at: path) }
        let store = FileReportDraftStore(directory: path)
        var draft = ReportDraft(type: .exists, spotId: spotID)
        var legacyLimits = limits
        legacyLimits.submissionProtocol = .appAttest
        let payload = try ReportRequest.encoded(draft: draft, installId: V3InstallID().installID(), limits: legacyLimits)
        draft.pendingSubmission = ReportPendingSubmission(schemaVersion: 2, payload: payload)
        try store.save(draft)
        try store.markSubmissionAttempt()
        let sender = V3Submitter([]), authorizer = V3Authorizer()
        let model = ReportModel(configClient: V3Config(limits: limits), reportClient: sender,
            store: store, installIDs: V3InstallID(), attestedClient: sender, authorizer: authorizer)
        await model.refreshAvailability()
        #expect(!model.canRetryAmbiguous)
        await model.retryAmbiguous()
        await model.submit()
        #expect(await authorizer.signedPayloads().isEmpty)
        #expect(await sender.envelopes().isEmpty)
    }

    @Test @MainActor func malformedPersistedPayloadCannotAuthorizeOrSend() async throws {
        let path = directory()
        defer { try? FileManager.default.removeItem(at: path) }
        let store = FileReportDraftStore(directory: path)
        var draft = ReportDraft(type: .exists, spotId: spotID)
        draft.pendingSubmission = ReportPendingSubmission(schemaVersion: 3, payload: Data("{}".utf8))
        try store.save(draft)
        try store.markSubmissionAttempt()
        let sender = V3Submitter([]), authorizer = V3Authorizer()
        let model = ReportModel(configClient: V3Config(limits: limits), reportClient: sender,
            store: store, installIDs: V3InstallID(), attestedClient: sender, authorizer: authorizer)
        await model.refreshAvailability()
        await model.retryAmbiguous()
        await model.submit()
        #expect(await authorizer.signedPayloads().isEmpty)
        #expect(await sender.envelopes().isEmpty)
    }
}
