import Foundation
import Testing
@testable import MannerPath

private actor MockReportTransport: ReportHTTPTransport {
    var responses: [ReportHTTPResponse]
    var requests: [URLRequest] = []
    init(_ responses: [ReportHTTPResponse]) { self.responses = responses }
    func send(_ request: URLRequest) async throws -> ReportHTTPResponse {
        requests.append(request)
        return responses.removeFirst()
    }
    func count() -> Int { requests.count }
}

private struct StaticConfig: ReportConfigFetching {
    let value: ReportAvailability
    func fetchAvailability() async throws -> ReportAvailability { value }
}

private struct FailingConfig: ReportConfigFetching {
    func fetchAvailability() async throws -> ReportAvailability { throw URLError(.notConnectedToInternet) }
}

private actor BlockingSubmitter: ReportSubmitting {
    let receipt: AcceptedReport
    private var count = 0
    private var startWaiter: CheckedContinuation<Void, Never>?
    private var completion: CheckedContinuation<AcceptedReport, Error>?

    init(receipt: AcceptedReport) { self.receipt = receipt }

    func submit(_ body: Data) async throws -> AcceptedReport {
        count += 1
        startWaiter?.resume()
        startWaiter = nil
        return try await withCheckedThrowingContinuation { completion = $0 }
    }

    func waitUntilStarted() async {
        if count > 0 { return }
        await withCheckedContinuation { startWaiter = $0 }
    }

    func finish() {
        completion?.resume(returning: receipt)
        completion = nil
    }

    func calls() -> Int { count }
}

private actor MockSubmitter: ReportSubmitting {
    var result: Result<AcceptedReport, Error>
    var count = 0
    init(_ result: Result<AcceptedReport, Error>) { self.result = result }
    func submit(_ body: Data) async throws -> AcceptedReport {
        count += 1
        return try result.get()
    }
    func calls() -> Int { count }
}

private struct FixedInstallID: InstallIDProviding {
    func installID() -> UUID { UUID(uuidString: "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f")! }
}

private final class FailingDeleteDraftStore: ReportDraftStoring, @unchecked Sendable {
    let underlying: FileReportDraftStore
    private let lock = NSLock()
    private var shouldFailDelete = true
    private var shouldFailAcceptedMarker = false

    init(directory: URL) { underlying = FileReportDraftStore(directory: directory) }
    func allowDelete() { lock.withLock { shouldFailDelete = false } }
    func failAcceptedMarker() { lock.withLock { shouldFailAcceptedMarker = true } }
    func load() throws -> ReportDraft? { try underlying.load() }
    func save(_ draft: ReportDraft) throws { try underlying.save(draft) }
    func delete() throws {
        if lock.withLock({ shouldFailDelete }) { throw URLError(.cannotRemoveFile) }
        try underlying.delete()
    }
    func submissionMarker() throws -> ReportSubmissionMarker? { try underlying.submissionMarker() }
    func markSubmissionAttempt() throws { try underlying.markSubmissionAttempt() }
    func markAcceptedForCleanup() throws {
        if lock.withLock({ shouldFailAcceptedMarker }) { throw URLError(.cannotWriteToFile) }
        try underlying.markAcceptedForCleanup()
    }
    func clearAcceptedCleanupMarker() throws { try underlying.clearAcceptedCleanupMarker() }
}

struct ReportFlowTests {
    let limits = ReportLimits(noteMaxLength: 280, maxBodyBytes: 4096)
    let pin = ReportCoordinate(latitude: 35.71123456, longitude: 139.77377654)

    @Test func allTypesMapExactlyAndRespectPrivacyBoundary() throws {
        let types = ["exists", "missing", "moved", "hoursChanged", "tobaccoTypeChanged", "accessChanged", "prohibited", "other"]
        #expect(ReportType.allCases.map(\.rawValue) == types)
        for type in ReportType.allCases {
            let draft = ReportDraft(type: type, spotId: type == .missing ? nil : "sp_123",
                                    proposedLocation: type.needsProposedLocation ? pin : nil,
                                    observedOn: "2024-02-29", note: "Observed")
            let body = try ReportRequest.encoded(draft: draft, installId: FixedInstallID().installID(), limits: limits)
            let object = try #require(JSONSerialization.jsonObject(with: body) as? [String: Any])
            #expect(Set(object.keys) == Set(["schemaVersion", "type", "observedOn", "note", "installId"] +
                                            (type == .missing ? [] : ["spotId"]) +
                                            (type.needsProposedLocation ? ["proposedLocation"] : [])))
            #expect(object["type"] as? String == type.rawValue)
            #expect((object["spotId"] as? String) == (type == .missing ? nil : "sp_123"))
            if let location = object["proposedLocation"] as? [String: Double] {
                #expect(location["latitude"] == 35.71123)
                #expect(location["longitude"] == 139.77378)
            }
        }
    }

    @Test func validationRequiresPinAndLimitsBody() throws {
        #expect(throws: ReportValidationError.missingProposedLocation) {
            try ReportRequest.encoded(draft: ReportDraft(type: .missing), installId: FixedInstallID().installID(), limits: limits)
        }
        #expect(throws: ReportValidationError.missingProposedLocation) {
            try ReportRequest.encoded(draft: ReportDraft(type: .moved, spotId: "sp_123"), installId: FixedInstallID().installID(), limits: limits)
        }
        #expect(throws: ReportValidationError.unexpectedProposedLocation) {
            try ReportRequest.encoded(draft: ReportDraft(type: .exists, spotId: "sp_123", proposedLocation: pin), installId: FixedInstallID().installID(), limits: limits)
        }
        #expect(throws: ReportValidationError.noteTooLong) {
            try ReportRequest.encoded(draft: ReportDraft(type: .exists, spotId: "sp_123", note: String(repeating: "x", count: 281)), installId: FixedInstallID().installID(), limits: limits)
        }
        #expect(throws: ReportValidationError.bodyTooLarge) {
            try ReportRequest.encoded(draft: ReportDraft(type: .exists, spotId: "sp_123"), installId: FixedInstallID().installID(), limits: .init(noteMaxLength: 280, maxBodyBytes: 10))
        }
    }

    @Test func noteLimitCountsUTF16CodeUnits() throws {
        let twoEmoji = "😀😀"
        #expect(twoEmoji.count == 2)
        #expect(twoEmoji.utf16.count == 4)
        let draft = ReportDraft(type: .exists, spotId: "sp_123", note: twoEmoji)
        #expect(throws: ReportValidationError.noteTooLong) {
            try ReportRequest.encoded(draft: draft, installId: FixedInstallID().installID(),
                                      limits: .init(noteMaxLength: 3, maxBodyBytes: 4096))
        }
        _ = try ReportRequest.encoded(draft: draft, installId: FixedInstallID().installID(),
                                      limits: .init(noteMaxLength: 4, maxBodyBytes: 4096))
    }

    @Test @MainActor func confirmedPinPersistsAtAPIPrecision() throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let store = FileReportDraftStore(directory: directory)
        let model = ReportModel(configClient: StaticConfig(value: .available(limits)),
                                reportClient: MockSubmitter(.failure(URLError(.notConnectedToInternet))),
                                store: store, installIDs: FixedInstallID())
        model.saveDraft(ReportDraft(type: .missing, proposedLocation: pin))
        let saved = try #require(try store.load())
        #expect(saved.proposedLocation?.latitude == 35.71123)
        #expect(saved.proposedLocation?.longitude == 139.77378)
        #expect(model.draft?.proposedLocation == saved.proposedLocation)
    }

    @Test func observedOnAcceptsOnlyRealCalendarDays() throws {
        let valid = ReportDraft(type: .exists, spotId: "sp_123", observedOn: "2024-02-29")
        let body = try ReportRequest.encoded(draft: valid, installId: FixedInstallID().installID(), limits: limits)
        let object = try #require(JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect(object["observedOn"] as? String == "2024-02-29")
        for invalid in ["2023-02-29", "2024-02-30", "2024-02-29T00:00:00Z", "2024-2-29"] {
            #expect(throws: ReportValidationError.invalidObservedDay) {
                try ReportRequest.encoded(draft: ReportDraft(type: .exists, spotId: "sp_123", observedOn: invalid),
                                          installId: FixedInstallID().installID(), limits: limits)
            }
        }
    }

    @Test func configGatesAvailabilityAndSchema() async throws {
        let body = #"{"schemaVersion":1,"apiVersion":"v1","schemaVersions":{"report":1},"minimumSupportedSchemaVersions":{"report":1},"reports":{"available":false,"maxBodyBytes":4096,"noteMaxLength":280}}"#.data(using: .utf8)!
        let transport = MockReportTransport([ReportHTTPResponse(statusCode: 200, body: body, retryAfter: nil)])
        let client = ReportAPIClient(baseURL: URL(string: "https://example.test")!, transport: transport)
        #expect(try await client.fetchAvailability() == .unavailable)
        let future = #"{"schemaVersion":1,"apiVersion":"v1","schemaVersions":{"report":2},"minimumSupportedSchemaVersions":{"report":2},"reports":{"available":true,"maxBodyBytes":4096,"noteMaxLength":280}}"#.data(using: .utf8)!
        let futureClient = ReportAPIClient(baseURL: URL(string: "https://example.test")!, transport: MockReportTransport([ReportHTTPResponse(statusCode: 200, body: future, retryAfter: nil)]))
        #expect(try await futureClient.fetchAvailability() == .incompatible)
    }

    @Test @MainActor func configFailurePreservesDraftAndUnknownAvailability() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let store = FileReportDraftStore(directory: directory)
        let saved = ReportDraft(type: .missing, proposedLocation: pin, observedOn: "2024-02-29", note: "Saved note")
        var expected = saved
        expected.proposedLocation = pin.quantized
        try store.save(saved)
        let submitter = MockSubmitter(.failure(URLError(.badServerResponse)))
        let model = ReportModel(configClient: FailingConfig(), reportClient: submitter,
                                store: store, installIDs: FixedInstallID())
        await model.refreshAvailability()
        #expect(model.availability == .unknown)
        #expect(model.draft == expected)
        await model.submit()
        #expect(await submitter.calls() == 0)
        #expect(try store.load() == expected)
    }

    @Test func draftAndInstallIDPersistThenDelete() throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let store = FileReportDraftStore(directory: directory)
        let draft = ReportDraft(type: .missing, proposedLocation: pin, observedOn: "2024-02-29", note: "A note")
        try store.save(draft)
        #expect(try store.load() == draft)
        try store.delete()
        #expect(try store.load() == nil)
        let suite = "ReportFlowTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let provider = UserDefaultsInstallID(defaults: defaults)
        #expect(provider.installID() == provider.installID())
        #expect(defaults.string(forKey: provider.key) != nil)
    }

    @Test @MainActor func ambiguousFailureRequiresExplicitRetry() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let submitter = MockSubmitter(.failure(URLError(.networkConnectionLost)))
        let model = ReportModel(configClient: StaticConfig(value: .available(limits)), reportClient: submitter,
                                store: FileReportDraftStore(directory: directory), installIDs: FixedInstallID())
        await model.refreshAvailability()
        model.start(type: .exists, spotId: "sp_123")
        await model.submit()
        #expect(model.submission == .ambiguous)
        await model.submit()
        #expect(await submitter.calls() == 1)
        #expect(model.draft != nil)
        model.cancel()
        #expect(model.draft == nil)
    }
}

extension ReportFlowTests {
    @Test @MainActor func repeatedTapWhileInFlightSendsOnce() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let receipt = AcceptedReport(schemaVersion: 1, reportId: "rp_123", state: "pending", receivedAt: "2026-09-20T09:30:00Z")
        let submitter = BlockingSubmitter(receipt: receipt)
        let model = ReportModel(configClient: StaticConfig(value: .available(limits)), reportClient: submitter,
                                store: FileReportDraftStore(directory: directory), installIDs: FixedInstallID())
        await model.refreshAvailability()
        model.start(type: .exists, spotId: "sp_123")
        let first = Task { await model.submit() }
        await submitter.waitUntilStarted()
        #expect(model.submission == .submitting)
        await model.submit()
        #expect(await submitter.calls() == 1)
        await submitter.finish()
        await first.value
        #expect(model.submission == .accepted(receipt))
    }

    @Test @MainActor func rateLimitBlocksImmediateRetry() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let submitter = MockSubmitter(.failure(ReportAPIError.rateLimited(61)))
        let model = ReportModel(configClient: StaticConfig(value: .available(limits)), reportClient: submitter,
                                store: FileReportDraftStore(directory: directory), installIDs: FixedInstallID())
        await model.refreshAvailability()
        model.start(type: .exists, spotId: "sp_123")
        await model.submit()
        #expect(model.submission == .rateLimited(61))
        #expect((model.retryAfterSecondsRemaining ?? 0) > 0)
        await model.submit()
        #expect(await submitter.calls() == 1)
    }

    @Test @MainActor func acceptedRemovesDraftAndCannotRepeat() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let store = FileReportDraftStore(directory: directory)
        let receipt = AcceptedReport(schemaVersion: 1, reportId: "rp_123", state: "pending", receivedAt: "2026-09-20T09:30:00Z")
        let submitter = MockSubmitter(.success(receipt))
        let model = ReportModel(configClient: StaticConfig(value: .available(limits)), reportClient: submitter,
                                store: store, installIDs: FixedInstallID())
        await model.refreshAvailability()
        model.start(type: .exists, spotId: "sp_123")
        await model.submit()
        #expect(model.submission == .accepted(receipt))
        #expect(model.draft == nil)
        #expect(try store.load() == nil)
        await model.submit()
        #expect(await submitter.calls() == 1)
    }

    @Test @MainActor func definiteRejectionKeepsCorrectableDraft() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let store = FileReportDraftStore(directory: directory)
        let submitter = MockSubmitter(.failure(ReportAPIError.rejected(400, "invalidReport")))
        let model = ReportModel(configClient: StaticConfig(value: .available(limits)), reportClient: submitter,
                                store: store, installIDs: FixedInstallID())
        await model.refreshAvailability()
        model.start(type: .exists, spotId: "sp_123")
        await model.submit()
        if case .rejected = model.submission {} else { Issue.record("Expected definite rejection") }
        #expect(try store.load() != nil)
        await model.submit()
        #expect(await submitter.calls() == 2)
    }

    @Test func rateLimitReadsRetryAfter() async throws {
        let transport = MockReportTransport([ReportHTTPResponse(statusCode: 429,
                                                                body: Data(#"{"error":"reportRateLimited"}"#.utf8),
                                                                retryAfter: "61")])
        let client = ReportAPIClient(baseURL: URL(string: "https://example.test")!, transport: transport)
        do {
            _ = try await client.submit(Data())
            Issue.record("Expected 429")
        } catch let error as ReportAPIError {
            #expect(error == .rateLimited(61))
        }
    }

    @Test func serverResponsesClassifyByProvenPreStoreCodes() async throws {
        let cases: [(Int, String, ReportAPIError)] = [
            (400, #"{"error":"invalidJson"}"#, .rejected(400, "invalidJson")),
            (400, #"{"error":"invalidReport"}"#, .rejected(400, "invalidReport")),
            (413, #"{"error":"reportTooLarge"}"#, .rejected(413, "reportTooLarge")),
            (503, #"{"error":"attestationUnavailable"}"#, .rejected(503, "attestationUnavailable")),
            (429, #"{"error":"unexpected"}"#, .incompatibleResponse),
            (429, "not JSON", .incompatibleResponse),
            (400, #"{"error":"unexpected"}"#, .incompatibleResponse),
            (413, #"{"error":"unexpected"}"#, .incompatibleResponse),
            (503, #"{"error":"upstreamError"}"#, .incompatibleResponse),
            (503, "not JSON", .incompatibleResponse),
            (500, #"{"error":"serverError"}"#, .incompatibleResponse),
            (502, "", .incompatibleResponse),
            (504, "", .incompatibleResponse),
            (200, "", .incompatibleResponse),
            (201, #"{"schemaVersion":1,"state":"pending"}"#, .incompatibleResponse)
        ]
        for (status, body, expected) in cases {
            let response = ReportHTTPResponse(statusCode: status, body: Data(body.utf8), retryAfter: nil)
            let client = ReportAPIClient(baseURL: URL(string: "https://example.test")!,
                                         transport: MockReportTransport([response]))
            do {
                _ = try await client.submit(Data())
                Issue.record("Expected failure for HTTP \(status): \(body)")
            } catch let error as ReportAPIError {
                #expect(error == expected)
            }
        }
    }

    @Test func onlyContractValid201ProvesAcceptance() async throws {
        let validID = "rp_01V64NN31G72E5KJJ5W22W1A1J"
        let cases: [(String, Bool)] = [
            (#"{"schemaVersion":1,"reportId":"rp_01V64NN31G72E5KJJ5W22W1A1J","state":"pending","receivedAt":"2026-09-20T09:30:00.000Z"}"#, true),
            (#"{"schemaVersion":1,"reportId":"rp_123","state":"pending","receivedAt":"2026-09-20T09:30:00Z"}"#, false),
            (#"{"schemaVersion":1,"reportId":"rp_01V64NN31G72E5KJJ5W22W1A1J","state":"pending","receivedAt":"yesterday"}"#, false),
            (#"{"schemaVersion":1,"reportId":"rp_01V64NN31G72E5KJJ5W22W1A1J","state":"pending","receivedAt":"2026-09-20T18:30:00+09:00"}"#, false)
        ]
        for (body, shouldAccept) in cases {
            let response = ReportHTTPResponse(statusCode: 201, body: Data(body.utf8), retryAfter: nil)
            let client = ReportAPIClient(baseURL: URL(string: "https://example.test")!,
                                         transport: MockReportTransport([response]))
            if shouldAccept {
                #expect(try await client.submit(Data()).reportId == validID)
            } else {
                do {
                    _ = try await client.submit(Data())
                    Issue.record("Malformed 201 should be ambiguous")
                } catch let error as ReportAPIError {
                    #expect(error == .incompatibleResponse)
                }
            }
        }
    }

    @Test @MainActor func acceptedDraftCannotResurrectWhenDeletionFails() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let store = FailingDeleteDraftStore(directory: directory)
        let receipt = AcceptedReport(schemaVersion: 1, reportId: "rp_123", state: "pending",
                                     receivedAt: "2026-09-20T09:30:00Z")
        let submitter = MockSubmitter(.success(receipt))
        let first = ReportModel(configClient: StaticConfig(value: .available(limits)), reportClient: submitter,
                                store: store, installIDs: FixedInstallID())
        await first.refreshAvailability()
        first.start(type: .exists, spotId: "sp_123")
        #expect(try store.load() != nil)
        await first.submit()
        #expect(first.submission == .accepted(receipt))
        #expect(try store.submissionMarker() == .accepted)
        #expect(try store.load() != nil)

        let relaunched = ReportModel(configClient: StaticConfig(value: .available(limits)), reportClient: submitter,
                                     store: store, installIDs: FixedInstallID())
        await relaunched.refreshAvailability()
        #expect(relaunched.draft == nil)
        relaunched.start(type: .exists, spotId: "sp_123")
        #expect(relaunched.draft == nil)
        await relaunched.submit()
        #expect(await submitter.calls() == 1)

        store.allowDelete()
        relaunched.retryAcceptedCleanup()
        #expect(try store.load() == nil)
        #expect(try store.submissionMarker() == nil)
    }

    @Test @MainActor func failedAcceptedMarkerTransitionCannotResubmitAfterRelaunch() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let store = FailingDeleteDraftStore(directory: directory)
        store.failAcceptedMarker()
        let receipt = AcceptedReport(schemaVersion: 1, reportId: "rp_123", state: "pending",
                                     receivedAt: "2026-09-20T09:30:00Z")
        let submitter = MockSubmitter(.success(receipt))
        let first = ReportModel(configClient: StaticConfig(value: .available(limits)), reportClient: submitter,
                                store: store, installIDs: FixedInstallID())
        await first.refreshAvailability()
        first.start(type: .exists, spotId: "sp_123")
        await first.submit()
        #expect(first.submission == .accepted(receipt))
        #expect(try store.submissionMarker() == .attempted)
        #expect(try store.load() != nil)

        let relaunched = ReportModel(configClient: StaticConfig(value: .available(limits)), reportClient: submitter,
                                     store: store, installIDs: FixedInstallID())
        await relaunched.refreshAvailability()
        #expect(relaunched.submission == .ambiguous)
        #expect(!relaunched.canRetryAmbiguous)
        await relaunched.submit()
        await relaunched.retryAmbiguous()
        #expect(await submitter.calls() == 1)
    }

    @Test @MainActor func ambiguousGatewayResponseNeedsExplicitRetry() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let response = ReportHTTPResponse(statusCode: 502, body: Data(), retryAfter: nil)
        let transport = MockReportTransport([response, response])
        let client = ReportAPIClient(baseURL: URL(string: "https://example.test")!, transport: transport)
        let model = ReportModel(configClient: StaticConfig(value: .available(limits)), reportClient: client,
                                store: FileReportDraftStore(directory: directory), installIDs: FixedInstallID())
        await model.refreshAvailability()
        model.start(type: .exists, spotId: "sp_123")
        await model.submit()
        #expect(model.submission == .ambiguous)
        await model.submit()
        #expect(await transport.count() == 1)
        #expect(model.draft != nil)
    }

    @Test @MainActor func attestationUnavailableResponseDisablesAvailability() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let response = ReportHTTPResponse(statusCode: 503,
                                          body: Data(#"{"error":"attestationUnavailable"}"#.utf8), retryAfter: nil)
        let transport = MockReportTransport([response])
        let client = ReportAPIClient(baseURL: URL(string: "https://example.test")!, transport: transport)
        let model = ReportModel(configClient: StaticConfig(value: .available(limits)), reportClient: client,
                                store: FileReportDraftStore(directory: directory), installIDs: FixedInstallID())
        await model.refreshAvailability()
        model.start(type: .exists, spotId: "sp_123")
        await model.submit()
        #expect(model.availability == .unavailable)
        #expect(model.draft != nil)
        #expect(await transport.count() == 1)
    }
}
