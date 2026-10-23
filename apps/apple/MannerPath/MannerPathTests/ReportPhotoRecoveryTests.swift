import Foundation
import Testing
import UIKit
@testable import MannerPath

// Interrupted photo uploads: the report is never sent twice, and after a restart the user can choose photos again for
// the same report under the same App Attest key. Photo bytes are never written to disk.
nonisolated private let recoveryTerms = "report-terms.2026-09-30.draft"
nonisolated private let recoveryReportID = "rp_01V64NN31G72E5KJJ5W22W1A1J"
nonisolated private let recoveryKeyID = Data(repeating: 9, count: 32).base64EncodedString()

private struct RecoveryConfig: ReportConfigFetching {
    func fetchAvailability() async throws -> ReportAvailability {
        .available(ReportLimits(noteMaxLength: 280, maxBodyBytes: 16_384, submissionProtocol: .appAttestV3,
                                maxSubmissionBytes: 32_768, termsVersion: recoveryTerms, acceptsPhotoEvidence: true))
    }
}

/// POST /reports: `dropFirst` loses the first answer after the server could have stored it.
private actor RecoveryReports: ReportSubmitting, AttestedReportSubmitting, InstallIDProviding {
    var payloads: [Data] = []
    var dropFirst: Bool
    let receivedAt: String
    init(dropFirst: Bool = false, receivedAt: String = ISO8601DateFormatter().string(from: Date())) {
        self.dropFirst = dropFirst
        self.receivedAt = receivedAt
    }
    func submit(_ body: Data) async throws -> AcceptedReport { throw ReportAPIError.httpStatus(503) }
    func submitAttested(_ envelope: Data) async throws -> AcceptedReport {
        let object = try JSONSerialization.jsonObject(with: envelope) as! [String: Any]
        payloads.append(Data(base64Encoded: object["payload"] as! String)!)
        if dropFirst {
            dropFirst = false
            throw URLError(.networkConnectionLost)
        }
        return AcceptedReport(schemaVersion: 3, reportId: recoveryReportID, state: "pending", receivedAt: receivedAt)
    }
    nonisolated func installID() -> UUID { UUID(uuidString: "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f")! }
    func sent() -> [Data] { payloads }
}

private actor RecoveryAuthorizer: ReportAuthorizing {
    func isSupported() async -> Bool { true }
    func authorize(payload: Data) async throws -> ReportAuthorization {
        ReportAuthorization(keyId: recoveryKeyID, challenge: "Y2hhbGxlbmdl", assertion: Data([1, 2, 3]))
    }
    func handleRejection(_ rejection: AttestationRejection, keyId: String) async {}
}

/// POST /photos answers in order: 201, a network loss (0), or an error status; 201 once the script runs out.
private actor RecoveryPhotoTransport: ReportHTTPTransport {
    var answers: [Int]
    var posts: [(reportId: String, keyId: String, idempotencyKey: String)] = []
    init(_ answers: [Int] = []) { self.answers = answers }
    func send(_ request: URLRequest) async throws -> ReportHTTPResponse {
        if request.httpMethod == "GET" {
            return ReportHTTPResponse(statusCode: 200, body: Data(#"{"reports":{"photoEvidenceEnabled":true}}"#.utf8), retryAfter: nil)
        }
        let envelope = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
        let attestation = envelope["attestation"] as! [String: Any]
        let payload = try JSONSerialization.jsonObject(with: Data(base64Encoded: envelope["payload"] as! String)!) as! [String: Any]
        posts.append((payload["reportId"] as! String, attestation["keyId"] as! String, payload["idempotencyKey"] as! String))
        let status = answers.isEmpty ? 201 : answers.removeFirst()
        switch status {
        case 0: throw URLError(.networkConnectionLost)
        case 201:
            let body = #"{"schemaVersion":2,"photoId":"ph_\#(posts.count)","reportId":"\#(recoveryReportID)","state":"pending"}"#
            return ReportHTTPResponse(statusCode: 201, body: Data(body.utf8), retryAfter: nil)
        default:
            let error = [410: "reportExpired", 503: "photoEvidenceDisabled"][status] ?? "reportStoreUnavailable"
            return ReportHTTPResponse(statusCode: status, body: Data(#"{"error":"\#(error)"}"#.utf8), retryAfter: nil)
        }
    }
    func sent() -> [(reportId: String, keyId: String, idempotencyKey: String)] { posts }
}

@MainActor
struct ReportPhotoRecoveryTests {
    private let pin = ReportCoordinate(latitude: 35.71123, longitude: 139.77378)
    private let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString, directoryHint: .isDirectory)

    private func image(_ seed: CGFloat = 0.5) -> Data {
        UIGraphicsImageRenderer(size: CGSize(width: 8, height: 6)).image { context in
            UIColor(white: seed, alpha: 1).setFill()
            context.fill(CGRect(x: 0, y: 0, width: 8, height: 6))
        }.pngData()!
    }

    /// One launch of the app: a fresh model over the same on-device directory.
    private func launch(reports: RecoveryReports = RecoveryReports(), photos: RecoveryPhotoTransport = RecoveryPhotoTransport()) async -> ReportModel {
        let authorizer = RecoveryAuthorizer()
        let uploader = AttestedEvidencePhotoUploader(baseURL: URL(string: "https://example.test")!, authorizer: authorizer,
                                                     transport: photos)
        let model = ReportModel(configClient: RecoveryConfig(), reportClient: reports,
                                store: FileReportDraftStore(directory: directory), installIDs: reports,
                                attestedClient: reports, authorizer: authorizer,
                                photoPolicy: PhotoEvidencePolicy(enabled: true, acceptedTermsVersion: recoveryTerms),
                                photoUploader: uploader,
                                photoFollowUps: FileReportPhotoFollowUpStore(directory: directory))
        await model.refreshAvailability()
        return model
    }

    private func submitNewSpot(_ model: ReportModel, photos: Int) async {
        model.startNewSpot(pin: pin)
        model.setTermsAccepted(true)
        for index in 0..<photos { model.photos.add(image(CGFloat(index) / 4)) }
        await model.submit()
    }

    private func storedFiles() -> [String] {
        (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
    }

    @Test func interruptedBeforeTheFirstPhotoResumesOnTheSameReportAfterRestart() async throws {
        let reports = RecoveryReports()
        let first = await launch(reports: reports, photos: RecoveryPhotoTransport([0, 0]))
        await submitNewSpot(first, photos: 2)
        guard case .accepted = first.submission else { Issue.record("not accepted: \(first.submission)"); return }
        #expect(first.photos.uploadedCount == 0)
        #expect(!first.canStartReport, "a new report would discard the photo follow-up")

        // Restart: photos are gone from memory, the report reference is not.
        let photos = RecoveryPhotoTransport()
        let second = await launch(reports: reports, photos: photos)
        #expect(second.photos.photos.isEmpty)
        #expect(second.photoFollowUp?.reportId == recoveryReportID)
        #expect(second.canResumePhotos)
        #expect(second.submission == .idle, "a follow-up never reads as a completed or listed report")
        #expect(second.photos.remainingSlots == 3)
        second.photos.add(image(0.2))
        await second.photos.retry()
        #expect(second.photos.allUploaded)
        let sent = await photos.sent()
        #expect(sent.count == 1 && sent[0].reportId == recoveryReportID && sent[0].keyId == recoveryKeyID)
        #expect(await reports.sent().count == 1, "the report is never resent")
        #expect(second.photoFollowUp == nil && second.canStartReport)
        #expect(!storedFiles().contains("photo-follow-up.json"))
    }

    @Test func partialUploadKeepsCountOfReceivedPhotosAcrossRestart() async {
        let reports = RecoveryReports()
        let first = await launch(reports: reports, photos: RecoveryPhotoTransport([201, 0, 0]))
        await submitNewSpot(first, photos: 3)
        #expect(first.photos.uploadedCount == 1)
        #expect(first.photoFollowUp?.uploadedCount == 1)

        let second = await launch(reports: reports)
        #expect(second.photos.previouslyUploaded == 1)
        #expect(second.photos.remainingSlots == 2, "the server already holds one of the three")
        for seed in [0.1, 0.2, 0.3] { second.photos.add(image(seed)) }
        #expect(second.photos.photos.count == 2)
        await second.photos.retry()
        #expect(second.photos.totalUploaded == 3)
        #expect(second.photoFollowUp == nil)
    }

    @Test func networkErrorRetriesInSessionWithTheSameKeysAndKeepsTheRecord() async {
        let photos = RecoveryPhotoTransport([0])
        let model = await launch(photos: photos)
        await submitNewSpot(model, photos: 1)
        #expect(model.photos.canRetry)
        #expect(model.photoFollowUp != nil)
        await model.photos.retry()
        #expect(model.photos.allUploaded)
        let keys = await photos.sent().map(\.idempotencyKey)
        #expect(keys.count == 2 && Set(keys).count == 1, "a retry reuses the photo's idempotency key")
        #expect(model.photoFollowUp == nil)
        #expect(!storedFiles().contains("photo-follow-up.json"))
    }

    @Test func noPhotoBytesOrKeysAreWrittenToDisk() async throws {
        let model = await launch(photos: RecoveryPhotoTransport([0]))
        await submitNewSpot(model, photos: 1)
        let data = try Data(contentsOf: directory.appending(path: "photo-follow-up.json"))
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(Set(object.keys) == ["reportId", "acceptedTermsVersion", "uploadDeadline", "uploadedCount"])
        #expect(!String(decoding: data, as: UTF8.self).contains(recoveryKeyID))
    }

    @Test func expiredFollowUpIsDroppedAtLaunchAndNothingIsSent() async {
        let old = ISO8601DateFormatter().string(from: Date().addingTimeInterval(-89 * 24 * 60 * 60 - 60))
        let reports = RecoveryReports(receivedAt: old)
        let first = await launch(reports: reports, photos: RecoveryPhotoTransport([0]))
        await submitNewSpot(first, photos: 1)

        let photos = RecoveryPhotoTransport()
        let second = await launch(reports: reports, photos: photos)
        #expect(second.photoFollowUp?.isExpired() == true)
        #expect(!second.canResumePhotos && !second.hasPendingPhotoFollowUp)
        #expect(second.canStartReport, "an expired follow-up does not block new reports")
        second.photos.add(image())
        await second.photos.retry()
        #expect(await photos.sent().isEmpty)
        #expect(!storedFiles().contains("photo-follow-up.json"))
    }

    @Test func serverExpiryEndsTheFollowUp() async {
        let reports = RecoveryReports()
        let first = await launch(reports: reports, photos: RecoveryPhotoTransport([0]))
        await submitNewSpot(first, photos: 1)
        let second = await launch(reports: reports, photos: RecoveryPhotoTransport([410]))
        second.photos.add(image())
        await second.photos.retry()
        #expect(second.photos.closedForPhotos)
        #expect(second.photoFollowUp == nil)
        #expect(!storedFiles().contains("photo-follow-up.json"))
    }

    @Test func stoppingTheFollowUpAllowsANewReportWithoutRestart() async {
        let model = await launch(photos: RecoveryPhotoTransport([0]))
        await submitNewSpot(model, photos: 1)
        #expect(!model.canStartReport)
        model.endPhotoFollowUp()
        #expect(model.photoFollowUp == nil && model.photos.photos.isEmpty)
        #expect(model.canStartReport)
        #expect(!storedFiles().contains("photo-follow-up.json"))
    }

    @Test func pausedPhotoIntakeKeepsTheFollowUpForALaterLaunch() async {
        let reports = RecoveryReports()
        let first = await launch(reports: reports, photos: RecoveryPhotoTransport([503]))
        await submitNewSpot(first, photos: 1)
        #expect(!first.photos.canRetry)
        #expect(first.photoFollowUp != nil)
        let second = await launch(reports: reports)
        #expect(second.canResumePhotos)
        #expect(await reports.sent().count == 1)
    }

    @Test func lostReportAnswerRetriesTheSameSubmissionOnlyAfterPhotosAreChosenAgain() async throws {
        let reports = RecoveryReports(dropFirst: true)
        let first = await launch(reports: reports)
        await submitNewSpot(first, photos: 1)
        #expect(first.submission == .ambiguous)

        let photos = RecoveryPhotoTransport()
        let second = await launch(reports: reports, photos: photos)
        #expect(second.submission == .ambiguous)
        #expect(second.ambiguousRetryNeedsPhotos && !second.canRetryAmbiguous,
                "a new place is never retried without photos to follow it")
        #expect(!second.canStartReport)
        second.photos.add(image())
        #expect(second.canRetryAmbiguous)
        await second.retryAmbiguous()
        guard case .accepted = second.submission else { Issue.record("not accepted: \(second.submission)"); return }
        let sent = await reports.sent()
        #expect(sent.count == 2 && sent[0] == sent[1], "the retry resends the identical payload and idempotency key")
        #expect(second.photos.allUploaded)
        #expect(await photos.sent().first?.reportId == recoveryReportID)
    }
}
