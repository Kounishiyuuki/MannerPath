#if DEBUG
import Foundation
import UIKit

/// UI-test-only report stack (`-uiTestPhotoReport <scenario>`): a deployment that advertises photo intake, a fake
/// App Attest authorizer and scripted uploads, so the photo flow can be driven without a server that accepts photos.
/// Never compiled into Release; production builds always use `ReportComposition`'s real stack.
nonisolated enum UITestPhotoReportStack {
    static let terms = "report-terms.2026-09-30.draft"

    @MainActor static func makeModel(scenario: String) -> ReportModel {
        let service = Service(photoIntake: scenario != "closed")
        ReportPhotos.uiTestSample = UIGraphicsImageRenderer(size: CGSize(width: 64, height: 48)).image { context in
            UIColor.systemTeal.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 64, height: 48))
        }.pngData()
        let directory = FileManager.default.temporaryDirectory.appending(path: "ui-test-reports-\(UUID().uuidString)")
        return ReportModel(configClient: service, reportClient: service,
                           store: FileReportDraftStore(directory: directory), installIDs: service,
                           attestedClient: service, authorizer: Authorizer(),
                           photoPolicy: PhotoEvidencePolicy(enabled: true, acceptedTermsVersion: terms),
                           photoUploader: Uploader(scenario: scenario))
    }

    private struct Service: ReportConfigFetching, ReportSubmitting, AttestedReportSubmitting, InstallIDProviding {
        let photoIntake: Bool
        func fetchAvailability() async throws -> ReportAvailability {
            .available(ReportLimits(noteMaxLength: 500, maxBodyBytes: 16_384, submissionProtocol: .appAttestV3,
                                    maxSubmissionBytes: 32_768, termsVersion: UITestPhotoReportStack.terms,
                                    acceptsNewSpotClaim: true, acceptsExistingSpotFindings: true,
                                    acceptsPhotoEvidence: photoIntake))
        }
        func submit(_ body: Data) async throws -> AcceptedReport { throw ReportAPIError.httpStatus(503) }
        func submitAttested(_ envelope: Data) async throws -> AcceptedReport {
            AcceptedReport(schemaVersion: 3, reportId: "rp_UITEST", state: "pending", receivedAt: "2026-10-22T00:00:00Z")
        }
        func installID() -> UUID { UUID(uuidString: "00000000-0000-4000-8000-000000000001")! }
    }

    private struct Authorizer: ReportAuthorizing {
        func isSupported() async -> Bool { true }
        func authorize(payload: Data) async throws -> ReportAuthorization {
            ReportAuthorization(keyId: Data(repeating: 7, count: 32).base64EncodedString(), challenge: "dGVzdA==", assertion: Data([1]))
        }
        func handleRejection(_ rejection: AttestationRejection, keyId: String) async {}
    }

    /// `retry`: each photo's first attempt fails as a network error. `expired`: the report window has closed.
    private actor Uploader: EvidencePhotoUploading {
        let scenario: String
        var attempted: Set<UUID> = []
        init(scenario: String) { self.scenario = scenario }
        func upload(reportID: String, attachmentID: UUID, jpeg: Data, acceptedTermsVersion: String) async throws {
            try await Task.sleep(for: .milliseconds(300))
            let first = attempted.insert(attachmentID).inserted
            if scenario == "retry" && first { throw EvidencePhotoUploadError.temporarilyUnavailable }
            if scenario == "expired" { throw EvidencePhotoUploadError.expired }
        }
    }
}
#endif
