import Foundation
import Testing
import UIKit
@testable import MannerPath

// v1.0 P0 photo form flow (P3): a new-place proposal is sent only together with photos, the report is sent once, and
// photos follow it under the same App Attest key; photo failures never resend the report.
nonisolated private let flowTerms = "report-terms.2026-09-30.draft"
nonisolated private let flowReportID = "rp_01V64NN31G72E5KJJ5W22W1A1J"
nonisolated private let flowKeyID = Data(repeating: 9, count: 32).base64EncodedString()

private struct FlowConfig: ReportConfigFetching {
    let photoIntake: Bool
    func fetchAvailability() async throws -> ReportAvailability {
        .available(ReportLimits(noteMaxLength: 280, maxBodyBytes: 16_384, submissionProtocol: .appAttestV3,
                                maxSubmissionBytes: 32_768, termsVersion: flowTerms, acceptsPhotoEvidence: photoIntake))
    }
}

private actor FlowReports: ReportSubmitting, AttestedReportSubmitting, InstallIDProviding {
    var envelopes: [Data] = []
    func submit(_ body: Data) async throws -> AcceptedReport { throw ReportAPIError.httpStatus(503) }
    func submitAttested(_ envelope: Data) async throws -> AcceptedReport {
        envelopes.append(envelope)
        return AcceptedReport(schemaVersion: 3, reportId: flowReportID, state: "pending", receivedAt: "2026-10-22T00:00:00Z")
    }
    nonisolated func installID() -> UUID { UUID(uuidString: "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f")! }
    func count() -> Int { envelopes.count }
}

/// One App Attest identity for everything the form signs.
private actor FlowAuthorizer: ReportAuthorizing {
    var payloads: [Data] = []
    func isSupported() async -> Bool { true }
    func authorize(payload: Data) async throws -> ReportAuthorization {
        payloads.append(payload)
        return ReportAuthorization(keyId: flowKeyID, challenge: "Y2hhbGxlbmdl", assertion: Data([1, 2, 3]))
    }
    func handleRejection(_ rejection: AttestationRejection, keyId: String) async {}
    func signed() -> [Data] { payloads }
}

/// The photo route: `failures` scripts the next answers to POST /photos (then 201).
private actor FlowPhotoTransport: ReportHTTPTransport {
    var failures: [Int]
    var photoKeys: [String] = []
    init(failures: [Int] = []) { self.failures = failures }
    func send(_ request: URLRequest) async throws -> ReportHTTPResponse {
        if request.httpMethod == "GET" {
            return ReportHTTPResponse(statusCode: 200, body: Data(#"{"reports":{"photoEvidenceEnabled":true}}"#.utf8), retryAfter: nil)
        }
        let envelope = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
        let attestation = envelope["attestation"] as! [String: Any]
        let payload = try JSONSerialization.jsonObject(with: Data(base64Encoded: envelope["payload"] as! String)!) as! [String: Any]
        #expect(attestation["keyId"] as? String == flowKeyID)
        photoKeys.append(payload["idempotencyKey"] as! String)
        if !failures.isEmpty {
            let status = failures.removeFirst()
            if status == 0 { throw URLError(.networkConnectionLost) }
            let error = status == 410 ? "reportExpired" : "reportStoreUnavailable"
            return ReportHTTPResponse(statusCode: status, body: Data(#"{"error":"\#(error)"}"#.utf8), retryAfter: nil)
        }
        let body = #"{"schemaVersion":2,"photoId":"ph_\#(photoKeys.count)","reportId":"\#(flowReportID)","state":"pending"}"#
        return ReportHTTPResponse(statusCode: 201, body: Data(body.utf8), retryAfter: nil)
    }
    func keys() -> [String] { photoKeys }
}

private struct ConfigTransport: ReportHTTPTransport {
    let body: Data
    func send(_ request: URLRequest) async throws -> ReportHTTPResponse { ReportHTTPResponse(statusCode: 200, body: body, retryAfter: nil) }
}

@MainActor
struct ReportPhotoFormFlowTests {
    private let pin = ReportCoordinate(latitude: 35.71123, longitude: 139.77378)

    private func image(_ seed: CGFloat = 0.5) -> Data {
        UIGraphicsImageRenderer(size: CGSize(width: 8, height: 6)).image { context in
            UIColor(white: seed, alpha: 1).setFill()
            context.fill(CGRect(x: 0, y: 0, width: 8, height: 6))
        }.pngData()!
    }

    private func model(photoIntake: Bool = true, policy: PhotoEvidencePolicy = PhotoEvidencePolicy(enabled: true, acceptedTermsVersion: flowTerms),
                       transport: FlowPhotoTransport = FlowPhotoTransport())
    async -> (ReportModel, FlowReports, FlowAuthorizer) {
        let reports = FlowReports(), authorizer = FlowAuthorizer()
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString, directoryHint: .isDirectory)
        // The same authorizer instance signs the report and the photos, as ReportComposition wires it.
        let uploader = AttestedEvidencePhotoUploader(baseURL: URL(string: "https://example.test")!, authorizer: authorizer,
                                                     transport: transport)
        let model = ReportModel(configClient: FlowConfig(photoIntake: photoIntake), reportClient: reports,
                                store: FileReportDraftStore(directory: directory), installIDs: reports,
                                attestedClient: reports, authorizer: authorizer,
                                photoPolicy: policy, photoUploader: uploader)
        await model.refreshAvailability()
        return (model, reports, authorizer)
    }

    private func newSpot(_ model: ReportModel, photos: Int) {
        model.startNewSpot(pin: pin)
        model.setTermsAccepted(true)
        for index in 0..<photos { model.photos.add(image(CGFloat(index) / 4)) }
    }

    @Test func closedPhotoIntakeBlocksNewPlacesBeforeAnythingIsSigned() async {
        for (intake, policy) in [(false, PhotoEvidencePolicy(enabled: true, acceptedTermsVersion: flowTerms)),
                                 (true, PhotoEvidencePolicy()),
                                 (true, PhotoEvidencePolicy(enabled: true, acceptedTermsVersion: "report-terms.other"))] {
            let (model, reports, authorizer) = await model(photoIntake: intake, policy: policy)
            #expect(!model.acceptsNewSpotProposals)
            newSpot(model, photos: 1)
            await model.submit()
            #expect(model.submission == .failed(String(localized: "New smoking places are not being accepted right now.")))
            #expect(await reports.count() == 0, "no photo-less report is stored")
            #expect(await authorizer.signed().isEmpty)
        }
    }

    @Test func newPlaceNeedsAPhotoAndConsentBeforeSubmitting() async {
        let (model, reports, _) = await model()
        #expect(model.acceptsNewSpotProposals)
        newSpot(model, photos: 0)
        await model.submit()
        #expect(model.submission == .failed(String(localized: "Add at least one photo of the smoking place to submit.")))
        model.photos.add(image())
        model.setTermsAccepted(false)
        await model.submit()
        #expect(model.submission == .failed(String(localized: "Read and agree to the report terms before submitting.")))
        #expect(await reports.count() == 0)
    }

    @Test func reportIsSentOnceThenEveryPhotoUnderTheSameKey() async throws {
        let transport = FlowPhotoTransport()
        let (model, reports, authorizer) = await model(transport: transport)
        newSpot(model, photos: 3)
        model.photos.add(image(0.9))
        #expect(model.photos.photos.count == 3, "at most three photos")
        await model.submit()
        guard case .accepted = model.submission else { Issue.record("not accepted: \(model.submission)"); return }
        #expect(await reports.count() == 1)
        #expect(model.photos.allUploaded)
        let signed = await authorizer.signed()
        #expect(signed.count == 4, "one report and three photo assertions from one authorizer")
        let report = try #require(JSONSerialization.jsonObject(with: signed[0]) as? [String: Any])
        #expect(report["type"] as? String == "missing" && report["image"] == nil, "the report itself never carries a photo")
        #expect(await transport.keys() == model.photos.photos.map { $0.id.uuidString.lowercased() })
    }

    @Test func photoFailureRetriesOnlyPhotosAndNeverClaimsCompletion() async {
        // Each photo fails once (store unavailable, then the network); the report is not resent.
        let transport = FlowPhotoTransport(failures: [503, 0])
        let (model, reports, _) = await model(transport: transport)
        newSpot(model, photos: 2)
        await model.submit()
        #expect(!model.photos.allUploaded)
        #expect(model.photos.canRetry)
        let failed = model.photos.photos.filter { $0.state == .failed }
        #expect(failed.count == 2)
        #expect(model.photos.failureMessage(for: failed[0].id)
                == String(localized: "Receipt of this photo could not be confirmed because of a connection problem. Retrying is safe: the same photo is not stored twice."))
        await model.submit()
        await model.photos.retry()
        #expect(model.photos.allUploaded)
        #expect(!model.photos.canRetry)
        #expect(await reports.count() == 1, "a photo retry never resends the report")
        let keys = await transport.keys()
        #expect(keys.count == 4 && Set(keys).count == 2, "retries reuse each photo's idempotency key")
    }

    @Test func expiredReportStopsPhotosWithoutRetry() async {
        let transport = FlowPhotoTransport(failures: [410])
        let (model, reports, _) = await model(transport: transport)
        newSpot(model, photos: 2)
        await model.submit()
        #expect(!model.photos.canRetry)
        #expect(model.photos.uploadedCount == 0)
        for photo in model.photos.photos {
            #expect(model.photos.failureMessage(for: photo.id) == String(localized: "The time for adding photos to this report has ended."))
        }
        #expect(await transport.keys().count == 1, "the remaining photo is not sent into a closed report")
        #expect(await reports.count() == 1)
    }

    @Test func existingPlaceReportsStillNeedNoPhoto() async {
        let (model, reports, _) = await model(photoIntake: false)
        model.start(type: .exists, spotId: "sp_01V64NN31G72E5KJJ5W22W1A1J")
        model.setTermsAccepted(true)
        await model.submit()
        guard case .accepted = model.submission else { Issue.record("not accepted: \(model.submission)"); return }
        #expect(await reports.count() == 1)
    }

    @Test func configAdvertisesPhotoIntakeOnlyWhenTrue() async throws {
        func limits(_ flag: String) async throws -> ReportLimits? {
            let body = #"{"schemaVersion":1,"apiVersion":"v1","schemaVersions":{"report":1},"minimumSupportedSchemaVersions":{"report":1},"reports":{"available":true,"maxBodyBytes":4096,"noteMaxLength":280\#(flag)}}"#
            let client = ReportAPIClient(baseURL: URL(string: "https://example.test")!, transport: ConfigTransport(body: Data(body.utf8)))
            if case .available(let limits) = try await client.fetchAvailability() { return limits }
            return nil
        }
        #expect(try await limits("")?.acceptsPhotoEvidence == false)
        #expect(try await limits(#","photoEvidenceEnabled":false"#)?.acceptsPhotoEvidence == false)
        #expect(try await limits(#","photoEvidenceEnabled":true"#)?.acceptsPhotoEvidence == true)
    }
}
