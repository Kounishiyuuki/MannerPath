#if DEBUG
import Foundation
import UIKit

/// UI-test-only report stack (`-uiTestPhotoReport <scenario>`): a deployment that advertises photo intake, a fake
/// App Attest authorizer and scripted uploads, so the photo flow can be driven without a server that accepts photos.
/// Never compiled into Release; production builds always use `ReportComposition`'s real stack.
/// `-uiTestReportPersistent YES` keeps drafts and photo follow-ups in one directory across launches, so a test can
/// terminate and relaunch the app (`-uiTestReportReset YES` empties it first). Every accepted report gets the next
/// `rp_UITEST<n>` reference, so a duplicate report is visible in the UI.
nonisolated enum UITestPhotoReportStack {
    static let terms = "report-terms.2026-09-30.draft"

    @MainActor static func makeModel(scenario: String) -> ReportModel {
        ReportPhotos.uiTestSample = UIGraphicsImageRenderer(size: CGSize(width: 64, height: 48)).image { context in
            UIColor.systemTeal.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 64, height: 48))
        }.pngData()
        let defaults = UserDefaults.standard
        let directory = defaults.bool(forKey: "uiTestReportPersistent")
            ? FileManager.default.temporaryDirectory.appending(path: "ui-test-reports-persistent")
            : FileManager.default.temporaryDirectory.appending(path: "ui-test-reports-\(UUID().uuidString)")
        if defaults.bool(forKey: "uiTestReportReset") { try? FileManager.default.removeItem(at: directory) }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let service = Service(photoIntake: scenario != "closed", directory: directory,
                              receivedAt: scenario == "old" ? "2020-01-01T00:00:00Z" : ISO8601DateFormatter().string(from: Date()))
        return ReportModel(configClient: service, reportClient: service,
                           store: FileReportDraftStore(directory: directory), installIDs: service,
                           attestedClient: service, authorizer: Authorizer(),
                           photoPolicy: PhotoEvidencePolicy(enabled: true, acceptedTermsVersion: terms),
                           photoUploader: Uploader(scenario: scenario, directory: directory),
                           photoFollowUps: scenario == "unsaved" ? UnwritableFollowUps() as any ReportPhotoFollowUpStoring
                                                                  : FileReportPhotoFollowUpStore(directory: directory))
    }

    private struct Service: ReportConfigFetching, ReportSubmitting, AttestedReportSubmitting, InstallIDProviding {
        let photoIntake: Bool
        let directory: URL
        let receivedAt: String
        func fetchAvailability() async throws -> ReportAvailability {
            .available(ReportLimits(noteMaxLength: 500, maxBodyBytes: 16_384, submissionProtocol: .appAttestV3,
                                    maxSubmissionBytes: 32_768, termsVersion: UITestPhotoReportStack.terms,
                                    acceptsNewSpotClaim: true, acceptsExistingSpotFindings: true,
                                    acceptsPhotoEvidence: photoIntake))
        }
        func submit(_ body: Data) async throws -> AcceptedReport { throw ReportAPIError.httpStatus(503) }
        func submitAttested(_ envelope: Data) async throws -> AcceptedReport {
            let count = Self.reportCount(in: directory) + 1
            try Data("\(count)".utf8).write(to: directory.appending(path: "ui-test-report-count"))
            return AcceptedReport(schemaVersion: 3, reportId: "rp_UITEST\(count)", state: "pending", receivedAt: receivedAt)
        }
        static func reportCount(in directory: URL) -> Int {
            (try? Data(contentsOf: directory.appending(path: "ui-test-report-count"))).flatMap { Int(String(decoding: $0, as: UTF8.self)) } ?? 0
        }
        func installID() -> UUID { UUID(uuidString: "00000000-0000-4000-8000-000000000001")! }
    }

    /// `unsaved`: the device refuses to write the follow-up record (and photos fail), so the form must warn.
    private struct UnwritableFollowUps: ReportPhotoFollowUpStoring {
        func load() throws -> ReportPhotoFollowUp? { nil }
        func save(_ followUp: ReportPhotoFollowUp) throws { throw CocoaError(.fileWriteOutOfSpace) }
        func delete() throws {}
    }

    private struct Authorizer: ReportAuthorizing {
        func isSupported() async -> Bool { true }
        func authorize(payload: Data) async throws -> ReportAuthorization {
            ReportAuthorization(keyId: Data(repeating: 7, count: 32).base64EncodedString(), challenge: "dGVzdA==", assertion: Data([1]))
        }
        func handleRejection(_ rejection: AttestationRejection, keyId: String) async {}
    }

    /// `retry`: each photo's first attempt fails as a network error. `expired`: the report window has closed.
    /// `offline`: every attempt fails as a network error. `closed`: photo intake is paused. `hang` and `old`: the
    /// upload never finishes, so the test can terminate the app mid-upload. A photo for any report other than the
    /// latest accepted one is refused, as the server would for a report this device does not own.
    private actor Uploader: EvidencePhotoUploading {
        let scenario: String
        let directory: URL
        var attempted: Set<UUID> = []
        init(scenario: String, directory: URL) {
            self.scenario = scenario
            self.directory = directory
        }
        func upload(reportID: String, attachmentID: UUID, jpeg: Data, acceptedTermsVersion: String) async throws {
            try await Task.sleep(for: .milliseconds(300))
            if scenario == "hang" || scenario == "old" { try await Task.sleep(for: .seconds(600)) }
            guard reportID == "rp_UITEST\(Service.reportCount(in: directory))" else { throw EvidencePhotoUploadError.reportNotFound }
            if scenario == "offline" || scenario == "unsaved" { throw EvidencePhotoUploadError.temporarilyUnavailable }
            if scenario == "closed" { throw EvidencePhotoUploadError.disabled }
            let first = attempted.insert(attachmentID).inserted
            if scenario == "retry" && first { throw EvidencePhotoUploadError.temporarilyUnavailable }
            if scenario == "expired" { throw EvidencePhotoUploadError.expired }
        }
    }
}
#endif
