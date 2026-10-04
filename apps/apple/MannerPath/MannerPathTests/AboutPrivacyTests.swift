import Foundation
import Testing
@testable import MannerPath

private actor PrivacyConfigSequence: ReportConfigFetching {
    private var values: [ReportAvailability]
    init(_ values: [ReportAvailability]) { self.values = values }
    func fetchAvailability() async throws -> ReportAvailability { values.removeFirst() }
}

private actor PrivacyTransport: ReportHTTPTransport {
    let config: Data
    private var requests: [URLRequest] = []
    init(config: Data) { self.config = config }
    func send(_ request: URLRequest) async throws -> ReportHTTPResponse {
        requests.append(request)
        guard request.httpMethod == "GET", request.url?.path == "/v1/config" else {
            throw URLError(.unsupportedURL)
        }
        return ReportHTTPResponse(statusCode: 200, body: config, retryAfter: nil)
    }
    func sentRequests() -> [URLRequest] { requests }
}

private struct PrivacyInstallID: InstallIDProviding {
    func installID() -> UUID { UUID(uuidString: "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f")! }
}

private actor PrivacyAuthorizer: ReportAuthorizing {
    private var calls = 0
    func isSupported() async -> Bool { true }
    func authorize(payload: Data) async throws -> ReportAuthorization {
        calls += 1
        throw URLError(.unsupportedURL)
    }
    func handleRejection(_ rejection: AttestationRejection, keyId: String) async {}
    func authorizationCalls() -> Int { calls }
}

struct AboutPrivacyTests {
    let limits = ReportLimits(noteMaxLength: 280, maxBodyBytes: 4096)

    @Test func reportsExplainEveryAvailabilityWithoutAdvertisingUnavailableIntake() {
        let cases: [(ReportAvailability, String)] = [
            (.unknown, String(localized: "Report availability could not be checked. Try again when connected.")),
            (.unavailable, String(localized: "Reports are currently unavailable.")),
            (.incompatible, String(localized: "Update the app to submit reports.")),
            (.attestationUnsupported, String(localized: "Secure reporting isn't supported on this device."))
        ]
        for (availability, expected) in cases {
            #expect(AboutPrivacyCopy.reportParagraphs(for: availability) == [expected])
        }
        #expect(AboutPrivacyCopy.reportParagraphs(for: .available(limits)) == [
            String(localized: "Reports are proposals for review and do not immediately change a listing."),
            String(localized: "For a missing or moved place, the proposed location is a map pin you choose. MannerPath does not automatically use your device position as that pin.")
        ])
    }

    @Test @MainActor func privacyExplanationTracksAvailabilityAfterRefresh() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let client = ReportAPIClient(baseURL: URL(string: "https://example.test")!,
                                     transport: PrivacyTransport(config: Data()))
        let model = ReportModel(configClient: PrivacyConfigSequence([.available(limits), .unavailable]),
                                reportClient: client, store: FileReportDraftStore(directory: directory),
                                installIDs: PrivacyInstallID())
        #expect(AboutPrivacyCopy.reportParagraphs(for: model.availability) == [
            String(localized: "Report availability could not be checked. Try again when connected.")
        ])
        await model.refreshAvailability()
        #expect(AboutPrivacyCopy.reportParagraphs(for: model.availability).count == 2)
        await model.refreshAvailability()
        #expect(AboutPrivacyCopy.reportParagraphs(for: model.availability) == [
            String(localized: "Reports are currently unavailable.")
        ])
    }

    @Test @MainActor func readOnlyAppAttestConfigDoesNotRegisterOrSubmitSavedDraft() async throws {
        let config = Data(#"{"schemaVersion":1,"apiVersion":"v1","schemaVersions":{"report":2},"minimumSupportedSchemaVersions":{"report":2},"reports":{"available":false,"attestation":"appAttest","maxBodyBytes":4096,"noteMaxLength":280}}"#.utf8)
        let transport = PrivacyTransport(config: config)
        let client = ReportAPIClient(baseURL: URL(string: "https://example.test")!, transport: transport)
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = FileReportDraftStore(directory: directory)
        let draft = ReportDraft(type: .exists, spotId: "sp_123")
        try store.save(draft)
        let authorizer = PrivacyAuthorizer()
        let model = ReportModel(configClient: client, reportClient: client, store: store,
                                installIDs: PrivacyInstallID(), attestedClient: client,
                                authorizer: authorizer)
        await model.refreshAvailability()
        #expect(model.availability == .unavailable)
        #expect(AboutPrivacyCopy.reportParagraphs(for: model.availability) == [
            String(localized: "Reports are currently unavailable.")
        ])
        await model.submit()
        #expect(await authorizer.authorizationCalls() == 0)
        #expect(!model.photos.enabled)
        #expect(model.draft == draft)
        #expect(try store.load() == draft)
        let requests = await transport.sentRequests()
        #expect(requests.count == 1)
        #expect(requests.allSatisfy { $0.httpMethod == "GET" && $0.url?.path == "/v1/config" })
    }
}
