import Foundation
import Testing
@testable import MannerPath

// v1.0 scope (2026-11-02): a new-place proposal is sent without photos while photo intake is closed. App Attest, the
// report terms and an explicitly confirmed pin stay required; a failure never sends the report twice.
nonisolated private let photolessTerms = "report-terms.2026-09-30.draft"

private struct PhotolessConfig: ReportConfigFetching {
    var availability: ReportAvailability = .available(ReportLimits(
        noteMaxLength: 280, maxBodyBytes: 16_384, submissionProtocol: .appAttestV3, maxSubmissionBytes: 32_768,
        termsVersion: photolessTerms, acceptsNewSpotClaim: true, acceptsPhotoEvidence: false))
    var offline = false
    func fetchAvailability() async throws -> ReportAvailability {
        if offline { throw URLError(.notConnectedToInternet) }
        return availability
    }
}

/// `failures` scripts the next answers to POST /reports (then 201): an Error to throw.
private actor PhotolessReports: ReportSubmitting, AttestedReportSubmitting, InstallIDProviding {
    var payloads: [Data] = []
    var failures: [any Error]
    init(failures: [any Error] = []) { self.failures = failures }
    func submit(_ body: Data) async throws -> AcceptedReport { throw ReportAPIError.httpStatus(503) }
    func submitAttested(_ envelope: Data) async throws -> AcceptedReport {
        let object = try JSONSerialization.jsonObject(with: envelope) as! [String: Any]
        payloads.append(Data(base64Encoded: object["payload"] as! String)!)
        if !failures.isEmpty { throw failures.removeFirst() }
        return AcceptedReport(schemaVersion: 3, reportId: "rp_01V64NN31G72E5KJJ5W22W1A1K", state: "pending",
                              receivedAt: "2026-11-02T00:00:00Z")
    }
    nonisolated func installID() -> UUID { UUID(uuidString: "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f")! }
    func sent() -> [Data] { payloads }
}

private actor PhotolessAuthorizer: ReportAuthorizing {
    let supported: Bool
    var signed = 0
    init(supported: Bool = true) { self.supported = supported }
    func isSupported() async -> Bool { supported }
    func authorize(payload: Data) async throws -> ReportAuthorization {
        signed += 1
        return ReportAuthorization(keyId: Data(repeating: 9, count: 32).base64EncodedString(),
                                   challenge: "Y2hhbGxlbmdl", assertion: Data([1, 2, 3]))
    }
    func handleRejection(_ rejection: AttestationRejection, keyId: String) async {}
    func count() -> Int { signed }
}

/// Fails the test if anything tries to upload a photo.
private struct NoPhotoUploads: EvidencePhotoUploading {
    func upload(reportID: String, attachmentID: UUID, jpeg: Data, acceptedTermsVersion: String) async throws {
        Issue.record("a photo was uploaded while photo intake is closed")
    }
}

@MainActor
struct ReportNewPlaceWithoutPhotosTests {
    private let pin = ReportCoordinate(latitude: 35.71123, longitude: 139.77378)
    private let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString, directoryHint: .isDirectory)

    private func launch(config: PhotolessConfig = PhotolessConfig(), reports: PhotolessReports = PhotolessReports(),
                        authorizer: PhotolessAuthorizer = PhotolessAuthorizer(),
                        // The Release policy: no photo terms version is reviewed.
                        policy: PhotoEvidencePolicy = .reviewed()) async -> ReportModel {
        let model = ReportModel(configClient: config, reportClient: reports,
                                store: FileReportDraftStore(directory: directory), installIDs: reports,
                                attestedClient: reports, authorizer: authorizer,
                                photoPolicy: policy, photoUploader: NoPhotoUploads())
        await model.refreshAvailability()
        return model
    }

    private func readyNewPlace(_ model: ReportModel) {
        model.startNewSpot(pin: pin)
        model.setTermsAccepted(true)
    }

    @Test func newPlaceIsSentOnceWithoutPhotosUnderAppAttest() async throws {
        let reports = PhotolessReports(), authorizer = PhotolessAuthorizer()
        let model = await launch(reports: reports, authorizer: authorizer)
        #expect(model.acceptsNewSpotProposals && !model.acceptsPhotoEvidence)
        readyNewPlace(model)
        var draft = try #require(model.draft)
        draft.claim?.spotType = "ashtray"
        draft.note = "入口の右側"
        model.saveDraft(draft)
        #expect(model.submissionReadinessMessage == nil, "no photo is asked for")
        await model.submit()
        guard case .accepted(let receipt) = model.submission else { Issue.record("not accepted: \(model.submission)"); return }
        #expect(receipt.state == "pending")
        let sent = await reports.sent()
        #expect(sent.count == 1)
        #expect(await authorizer.count() == 1, "the report is signed with App Attest")
        let payload = try #require(try JSONSerialization.jsonObject(with: sent[0]) as? [String: Any])
        #expect(payload["type"] as? String == "missing")
        #expect(payload["acceptedTermsVersion"] as? String == photolessTerms)
        #expect(payload["proposedLocation"] != nil && payload["spotId"] == nil)
        #expect(payload["photos"] == nil && payload["photoCount"] == nil, "the payload carries no photo fields")
        #expect(model.photoFollowUp == nil && model.photos.photos.isEmpty)
        #expect(model.draft == nil)
        await model.submit()
        #expect(await reports.sent().count == 1, "an accepted report cannot be submitted again")
    }

    @Test func photoIntakeOpenStillRequiresPhotos() async {
        // v1.1: the deployment and this build both accept photos, so the earlier photo rule applies unchanged.
        let config = PhotolessConfig(availability: .available(ReportLimits(
            noteMaxLength: 280, maxBodyBytes: 16_384, submissionProtocol: .appAttestV3, maxSubmissionBytes: 32_768,
            termsVersion: photolessTerms, acceptsPhotoEvidence: true)))
        let reports = PhotolessReports()
        let model = await launch(config: config, reports: reports,
                                 policy: PhotoEvidencePolicy(enabled: true, acceptedTermsVersion: photolessTerms))
        #expect(model.acceptsPhotoEvidence)
        readyNewPlace(model)
        #expect(model.submissionReadinessMessage == String(localized: "Add at least one photo of the smoking place to submit."))
        await model.submit()
        #expect(model.submission == .failed(String(localized: "Add at least one photo of the smoking place to submit.")))
        #expect(await reports.sent().isEmpty)
    }

    @Test func pinAndTermsAreStillRequiredAndNothingIsSignedBefore() async throws {
        let reports = PhotolessReports(), authorizer = PhotolessAuthorizer()
        let model = await launch(reports: reports, authorizer: authorizer)
        model.startNewSpot(pin: nil)
        model.setTermsAccepted(true)
        #expect(model.submissionReadinessMessage == String(localized: "Choose and confirm a proposed map pin."))
        await model.submit()
        #expect(model.submission == .failed(String(localized: "Choose and confirm a proposed map pin.")))
        var draft = try #require(model.draft)
        draft.proposedLocation = pin
        model.saveDraft(draft)
        model.setTermsAccepted(false)
        #expect(model.submissionReadinessMessage == String(localized: "Read and agree to the report terms before submitting."))
        await model.submit()
        #expect(model.submission == .failed(String(localized: "Read and agree to the report terms before submitting.")))
        draft = try #require(model.draft)
        draft.note = String(repeating: "a", count: 281)
        model.saveDraft(draft)
        model.setTermsAccepted(true)
        #expect(model.submissionReadinessMessage == String(localized: "Shorten the note to the character limit."))
        #expect(await reports.sent().isEmpty)
        #expect(await authorizer.count() == 0)
    }

    @Test func unavailableReportingOrNoAppAttestSendsNothing() async {
        for (config, authorizer) in [(PhotolessConfig(availability: .unavailable), PhotolessAuthorizer()),
                                     (PhotolessConfig(offline: true), PhotolessAuthorizer()),
                                     (PhotolessConfig(), PhotolessAuthorizer(supported: false))] {
            let reports = PhotolessReports()
            let model = await launch(config: config, reports: reports, authorizer: authorizer)
            #expect(!model.acceptsNewSpotProposals, "the entry shows the pause instead of a form")
            readyNewPlace(model)
            await model.submit()
            #expect(await reports.sent().isEmpty)
            #expect(await authorizer.count() == 0)
        }
    }

    @Test func choosingAnExistingPlaceSendsAConfirmationInstead() async throws {
        let reports = PhotolessReports()
        let model = await launch(reports: reports)
        readyNewPlace(model)
        model.confirmExistingInstead(spotId: "sp_01JABCDEFGHJKMNPQRSTVWXYZ0", subjectName: "上野駅前")
        #expect(model.draft?.type == .exists && model.draft?.proposedLocation == nil)
        await model.submit()
        guard case .accepted = model.submission else { Issue.record("not accepted: \(model.submission)"); return }
        let sent = try #require(await reports.sent().first)
        let payload = try #require(try JSONSerialization.jsonObject(with: sent) as? [String: Any])
        #expect(payload["type"] as? String == "exists" && payload["spotId"] as? String == "sp_01JABCDEFGHJKMNPQRSTVWXYZ0")
    }

    @Test func lostAnswerRetriesTheSamePayloadWithoutPhotosEvenAfterRestart() async throws {
        let reports = PhotolessReports(failures: [URLError(.networkConnectionLost)])
        let first = await launch(reports: reports)
        readyNewPlace(first)
        await first.submit()
        #expect(first.submission == .ambiguous)
        #expect(!first.ambiguousRetryNeedsPhotos && first.canRetryAmbiguous)

        let second = await launch(reports: reports)
        #expect(second.submission == .ambiguous)
        #expect(!second.ambiguousRetryNeedsPhotos && second.canRetryAmbiguous, "a photo-less report retries as saved")
        await second.retryAmbiguous()
        guard case .accepted = second.submission else { Issue.record("not accepted: \(second.submission)"); return }
        let sent = await reports.sent()
        #expect(sent.count == 2 && sent[0] == sent[1], "the retry resends the identical payload and idempotency key")
    }

    @Test func rateLimitKeepsTheDraftAndWaits() async throws {
        let reports = PhotolessReports(failures: [ReportAPIError.rateLimited(30)])
        let model = await launch(reports: reports)
        readyNewPlace(model)
        await model.submit()
        #expect(model.submission == .rateLimited(30))
        #expect(model.draft != nil)
        await model.submit()
        #expect(await reports.sent().count == 1, "nothing is sent again before Retry-After")
        #expect((model.retryAfterSecondsRemaining ?? 0) > 0)
    }

    @Test func offlineAfterOpeningTheFormLeavesTheReportUnconfirmed() async {
        let reports = PhotolessReports(failures: [URLError(.notConnectedToInternet)])
        let model = await launch(reports: reports)
        readyNewPlace(model)
        await model.submit()
        #expect(model.submission == .ambiguous, "never reported as received")
        #expect(model.canRetryAmbiguous && model.draft != nil)
    }
}
