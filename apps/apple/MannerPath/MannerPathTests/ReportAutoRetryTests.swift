import Foundation
import Testing
@testable import MannerPath

// A v3 report whose answer was lost to a transient failure (Workers 1102 / 5xx / dropped connection) is repeated
// automatically, at most twice, as the same payload and idempotency key signed over a new challenge. The server
// stores it once and replays its receipt (200, same reportId). Refusals and 429 are never repeated automatically.
nonisolated private let retryTerms = "report-terms.2026-09-30.draft"
nonisolated private let reportID = "rp_01V64NN31G72E5KJJ5W22W1A1K"

private struct RetryConfig: ReportConfigFetching {
    func fetchAvailability() async throws -> ReportAvailability {
        .available(ReportLimits(noteMaxLength: 280, maxBodyBytes: 16_384, submissionProtocol: .appAttestV3,
                                maxSubmissionBytes: 32_768, termsVersion: retryTerms, acceptsNewSpotClaim: true,
                                acceptsPhotoEvidence: false))
    }
}

private enum Answer {
    case status(Int, String, retryAfter: String? = nil)
    case failure(URLError.Code)
}

/// Scripted answers to POST /v1/reports, through the real `ReportAPIClient` response classification.
private actor ScriptedTransport: ReportHTTPTransport {
    var answers: [Answer]
    var envelopes: [Data] = []
    init(_ answers: [Answer]) { self.answers = answers }
    func send(_ request: URLRequest) async throws -> ReportHTTPResponse {
        envelopes.append(request.httpBody ?? Data())
        switch answers.isEmpty ? .status(500, "") : answers.removeFirst() {
        case .status(let code, let body, let retryAfter):
            return ReportHTTPResponse(statusCode: code, body: Data(body.utf8), retryAfter: retryAfter)
        case .failure(let code): throw URLError(code)
        }
    }
    func sent() -> [Data] { envelopes }
}

private struct FixedInstall: InstallIDProviding {
    func installID() -> UUID { UUID(uuidString: "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f")! }
}

/// Each authorization is over a new challenge, as `AppAttestReportAuthorizer` requests one per call.
private actor CountingAuthorizer: ReportAuthorizing {
    var challenges: [String] = []
    func isSupported() async -> Bool { true }
    func authorize(payload: Data) async throws -> ReportAuthorization {
        let challenge = Data("challenge-\(challenges.count)".utf8).base64EncodedString()
        challenges.append(challenge)
        return ReportAuthorization(keyId: Data(repeating: 9, count: 32).base64EncodedString(),
                                   challenge: challenge, assertion: Data([1, 2, 3]))
    }
    func handleRejection(_ rejection: AttestationRejection, keyId: String) async {}
    func used() -> [String] { challenges }
}

private actor Sleeps {
    var delays: [Duration] = []
    func record(_ delay: Duration) { delays.append(delay) }
    func all() -> [Duration] { delays }
}

private let accepted201 = #"{"schemaVersion":3,"reportId":"\#(reportID)","state":"pending","receivedAt":"2026-11-04T00:00:00Z"}"#
private let cpuLimit1102 = "<html><title>Worker exceeded resource limits</title>Error 1102</html>"

@MainActor
struct ReportAutoRetryTests {
    private func model(_ transport: ScriptedTransport, authorizer: CountingAuthorizer = CountingAuthorizer(),
                       sleeps: Sleeps = Sleeps(), sleep: (@Sendable (Duration) async throws -> Void)? = nil) async -> ReportModel {
        let client = ReportAPIClient(baseURL: URL(string: "https://example.test")!, transport: transport)
        var policy = ReportRetryPolicy()
        policy.jitter = { 1.0 }
        policy.sleep = sleep ?? { await sleeps.record($0) }
        let model = ReportModel(configClient: RetryConfig(), reportClient: client,
                                store: FileReportDraftStore(directory: FileManager.default.temporaryDirectory
                                    .appending(path: UUID().uuidString, directoryHint: .isDirectory)),
                                installIDs: FixedInstall(),
                                attestedClient: client, authorizer: authorizer, retryPolicy: policy)
        await model.refreshAvailability()
        model.startNewSpot(pin: ReportCoordinate(latitude: 35.71123, longitude: 139.77378))
        model.setTermsAccepted(true)
        return model
    }

    private func payloads(_ envelopes: [Data]) throws -> [Data] {
        try envelopes.map { envelope in
            let object = try #require(try JSONSerialization.jsonObject(with: envelope) as? [String: Any])
            let encoded = try #require(object["payload"] as? String)
            return try #require(Data(base64Encoded: encoded))
        }
    }

    private func challenges(_ envelopes: [Data]) throws -> [String] {
        try envelopes.map { envelope in
            let object = try #require(try JSONSerialization.jsonObject(with: envelope) as? [String: Any])
            let attestation = try #require(object["attestation"] as? [String: Any])
            return try #require(attestation["challenge"] as? String)
        }
    }

    @Test func classifiesTransientAnswersSeparatelyFromRefusals() async {
        for (code, body, expected) in [(503, cpuLimit1102, ReportAPIError.transientStatus(503)),
                                       (500, "", .transientStatus(500)), (502, "", .transientStatus(502)),
                                       (504, "", .transientStatus(504)),
                                       (503, #"{"error":"attestationUnavailable"}"#, .rejected(503, "attestationUnavailable")),
                                       (400, #"{"error":"invalidReport","detail":"note: too_big"}"#, .rejected(400, "invalidReport")),
                                       (409, #"{"error":"termsVersionOutdated"}"#, .rejected(409, "termsVersionOutdated"))] {
            let client = ReportAPIClient(baseURL: URL(string: "https://example.test")!,
                                         transport: ScriptedTransport([.status(code, body)]))
            await #expect(throws: expected) { _ = try await client.submit(Data()) }
        }
    }

    @Test func lostAnswersAreRepeatedAsTheSameReportUntilTheReceiptIsReplayed() async throws {
        // 1102 (CPU limit), then a dropped connection, then the replayed receipt for the report stored earlier.
        let transport = ScriptedTransport([.status(503, cpuLimit1102), .failure(.networkConnectionLost),
                                           .status(200, accepted201)])
        let authorizer = CountingAuthorizer(), sleeps = Sleeps()
        let model = await model(transport, authorizer: authorizer, sleeps: sleeps)
        await model.submit()
        guard case .accepted(let receipt) = model.submission else { Issue.record("not accepted: \(model.submission)"); return }
        #expect(receipt.reportId == reportID)
        #expect(model.draft == nil)
        let sent = await transport.sent()
        #expect(sent.count == 3)
        let bodies = try payloads(sent)
        #expect(Set(bodies).count == 1, "the payload, and with it the idempotency key, never changes")
        let signed = try challenges(sent)
        #expect(Set(signed).count == 3, "every attempt is signed over a new challenge")
        #expect(await authorizer.used().count == 3)
        #expect(await sleeps.all() == [.seconds(1), .seconds(2)], "exponential backoff before each repeat")
    }

    @Test func jitterSpreadsTheBackoffWithoutExceedingIt() {
        var policy = ReportRetryPolicy()
        policy.jitter = { 0.5 }
        #expect(policy.delay(1) == .milliseconds(500) && policy.delay(2) == .seconds(1))
        policy = ReportRetryPolicy()
        for retry in 1...2 {
            let delay = policy.delay(retry), cap = Duration.seconds(1 << (retry - 1))
            #expect(delay >= cap / 2 && delay <= cap)
        }
    }

    @Test func afterTwoRepeatsTheReportWaitsForTheUserAndKeepsItsInput() async throws {
        let transport = ScriptedTransport([.status(503, cpuLimit1102), .status(502, ""), .failure(.timedOut),
                                           .status(200, accepted201)])
        let model = await model(transport)
        await model.submit()
        #expect(model.submission == .ambiguous)
        #expect(await transport.sent().count == 3, "one send and at most two automatic repeats")
        #expect(model.draft?.proposedLocation != nil && model.canRetryAmbiguous, "the input stays for a manual retry")
        await model.retryAmbiguous()
        guard case .accepted(let receipt) = model.submission else { Issue.record("not accepted: \(model.submission)"); return }
        #expect(receipt.reportId == reportID)
        let sent = await transport.sent()
        let bodies = try payloads(sent)
        #expect(sent.count == 4 && Set(bodies).count == 1)
    }

    @Test func refusalsAndRateLimitsAreNeverRepeatedAutomatically() async {
        for answer in [Answer.status(400, #"{"error":"invalidReport","detail":"proposedLocation: outside_service_area"}"#),
                       .status(409, #"{"error":"termsVersionOutdated"}"#),
                       .status(503, #"{"error":"attestationUnavailable"}"#),
                       .status(403, #"{"error":"attestationRejected","reason":"assertionInvalid"}"#),
                       .status(429, #"{"error":"reportRateLimited"}"#, retryAfter: "30"),
                       .status(200, #"{"unexpected":true}"#)] {
            let transport = ScriptedTransport([answer, .status(200, accepted201)]), sleeps = Sleeps()
            let model = await model(transport, sleeps: sleeps)
            await model.submit()
            #expect(await transport.sent().count == 1, "\(answer)")
            #expect(await sleeps.all().isEmpty)
            #expect(model.draft != nil, "the input is kept")
            if case .accepted = model.submission { Issue.record("accepted after a refusal") }
        }
    }

    @Test func rateLimitWaitsForRetryAfterBeforeAnySend() async {
        let transport = ScriptedTransport([.status(429, #"{"error":"reportRateLimited"}"#, retryAfter: "30"),
                                           .status(201, accepted201)])
        let model = await model(transport)
        await model.submit()
        #expect(model.submission == .rateLimited(30))
        await model.submit()
        #expect(await transport.sent().count == 1, "nothing is sent before Retry-After")
    }

    @Test func tapsDuringTheBackoffAddNoSend() async throws {
        let transport = ScriptedTransport([.failure(.networkConnectionLost), .status(201, accepted201)])
        let gate = AsyncStream<Void>.makeStream()
        let waiting = AsyncStream<Void>.makeStream()
        let model = await model(transport, sleep: { _ in
            waiting.continuation.yield()
            for await _ in gate.stream { break }
        })
        let running = Task { await model.submit() }
        for await _ in waiting.stream { break }
        #expect(model.isBusy && !model.canEditDraft && !model.canRetryAmbiguous)
        await model.submit()
        await model.retryAmbiguous()
        #expect(await transport.sent().count == 1, "the form is locked while the repeat waits")
        gate.continuation.yield()
        await running.value
        guard case .accepted = model.submission else { Issue.record("not accepted: \(model.submission)"); return }
        #expect(await transport.sent().count == 2)
    }

    @Test func cancelledBackoffLeavesTheReportForAManualRetry() async {
        let transport = ScriptedTransport([.failure(.networkConnectionLost), .status(201, accepted201)])
        let model = await model(transport, sleep: { _ in throw CancellationError() })
        await model.submit()
        #expect(model.submission == .ambiguous && model.canRetryAmbiguous)
        #expect(await transport.sent().count == 1)
    }
}
