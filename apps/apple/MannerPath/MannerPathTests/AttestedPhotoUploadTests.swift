import Foundation
import Testing
import UIKit
@testable import MannerPath

private final class PhotoVectorBundleAnchor {}

private struct PhotoUploadVectors: Decodable {
    struct Case: Decodable {
        let name: String
        let reportId: String
        let idempotencyKey: String
        let acceptedTermsVersion: String
        let jpegBase64: String
        let payloadBase64: String
    }
    let contract: String
    let version: Int
    let cases: [Case]

    static func load() throws -> Self {
        let bundle = Bundle(for: PhotoVectorBundleAnchor.self)
        let url = try #require(bundle.url(forResource: "photo-upload-vectors.v1", withExtension: "json"))
        return try JSONDecoder().decode(Self.self, from: Data(contentsOf: url))
    }
}

// MARK: - Test doubles

/// Records every payload it is asked to sign; each call is a fresh challenge, as the real authorizer's is.
private actor RecordingPhotoAuthorizer: ReportAuthorizing {
    private(set) var payloads: [Data] = []
    private(set) var rejections: [AttestationRejection] = []
    var failure: ReportAuthorizationError?

    func set(failure: ReportAuthorizationError?) { self.failure = failure }
    func isSupported() -> Bool { true }
    func authorize(payload: Data) throws -> ReportAuthorization {
        if let failure { throw failure }
        payloads.append(payload)
        let challenge = Data(repeating: UInt8(payloads.count), count: 32).base64EncodedString()
        return ReportAuthorization(keyId: Data(repeating: 7, count: 32).base64EncodedString(), challenge: challenge,
                                   assertion: Data("assertion-\(payloads.count)".utf8))
    }
    func handleRejection(_ rejection: AttestationRejection, keyId: String) { rejections.append(rejection) }
}

/// A local stand-in for the Worker: config, then the photo route, answering from a queue.
private actor PhotoTransport: ReportHTTPTransport {
    private(set) var requests: [URLRequest] = []
    var photoEvidenceEnabled: Bool? = true
    var answers: [(Int, String)] = []
    var throwsOnPhoto = false

    func set(enabled: Bool?) { photoEvidenceEnabled = enabled }
    func set(answers: [(Int, String)]) { self.answers = answers }
    func set(throwsOnPhoto: Bool) { self.throwsOnPhoto = throwsOnPhoto }
    var photoPosts: [URLRequest] { requests.filter { $0.httpMethod == "POST" } }

    func send(_ request: URLRequest) async throws -> ReportHTTPResponse {
        requests.append(request)
        if request.url?.path == "/v1/config" {
            let flag = photoEvidenceEnabled.map { #","photoEvidenceEnabled":\#($0)"# } ?? ""
            return ReportHTTPResponse(statusCode: 200, body: Data(#"{"reports":{"available":true\#(flag)}}"#.utf8), retryAfter: nil)
        }
        if throwsOnPhoto { throw URLError(.notConnectedToInternet) }
        let (status, body) = answers.isEmpty ? (201, accepted()) : answers.removeFirst()
        return ReportHTTPResponse(statusCode: status, body: Data(body.utf8), retryAfter: status == 429 ? "30" : nil)
    }
}

nonisolated private let reportID = "rp_01V64NN31G72E5KJJ5W22W1A1J"
nonisolated private let terms = "report-terms.2026-09-30.draft"
nonisolated private func accepted(_ photo: String = "ph_1", state: String = "pending") -> String {
    #"{"schemaVersion":2,"photoId":"\#(photo)","reportId":"\#(reportID)","state":"\#(state)"}"#
}

private struct Envelope: Decodable {
    struct Attestation: Decodable { let keyId: String; let challenge: String; let assertion: String }
    let schemaVersion: Int
    let payload: String
    let attestation: Attestation
}

// MARK: - Uploader

struct AttestedPhotoUploaderTests {
    private func make() -> (AttestedEvidencePhotoUploader, PhotoTransport, RecordingPhotoAuthorizer) {
        let transport = PhotoTransport(), authorizer = RecordingPhotoAuthorizer()
        return (AttestedEvidencePhotoUploader(baseURL: URL(string: "https://api.example.invalid")!,
                                              authorizer: authorizer, transport: transport), transport, authorizer)
    }

    @Test func signedPayloadIsExactlyTheSharedContractVector() throws {
        let vectors = try PhotoUploadVectors.load()
        #expect(vectors.contract == "mannerpath-photo-upload-vectors")
        for c in vectors.cases {
            let payload = try AttestedEvidencePhotoUploader.payload(
                reportID: c.reportId, attachmentID: try #require(UUID(uuidString: c.idempotencyKey)),
                jpeg: try #require(Data(base64Encoded: c.jpegBase64)), acceptedTermsVersion: c.acceptedTermsVersion)
            #expect(payload == Data(base64Encoded: c.payloadBase64), "\(c.name)")
        }
    }

    @Test func uploadSignsTheExactPayloadAndPostsTheSchema2Envelope() async throws {
        let (uploader, transport, authorizer) = make()
        let id = UUID()
        try await uploader.upload(reportID: reportID, attachmentID: id, jpeg: Data([0xff, 0xd8, 0xff]), acceptedTermsVersion: terms)
        let post = try #require(await transport.photoPosts.first)
        #expect(post.url?.path == "/v1/reports/\(reportID)/photos")
        #expect(post.value(forHTTPHeaderField: "Content-Type") == "application/json")
        let envelope = try JSONDecoder().decode(Envelope.self, from: try #require(post.httpBody))
        let signed = try #require(await authorizer.payloads.first)
        #expect(envelope.schemaVersion == 2)
        #expect(Data(base64Encoded: envelope.payload) == signed, "the base64 payload is the very bytes signed")
        #expect(Data(base64Encoded: envelope.attestation.assertion) == Data("assertion-1".utf8))
        let fields = try #require(JSONSerialization.jsonObject(with: signed) as? [String: Any])
        #expect(fields["reportId"] as? String == reportID)
        #expect(fields["idempotencyKey"] as? String == id.uuidString.lowercased())
        #expect(fields["acceptedTermsVersion"] as? String == terms)
        #expect(fields["mediaType"] as? String == "image/jpeg")
        #expect(fields["schemaVersion"] as? Int == 2)
    }

    @Test func retrySignsAFreshChallengeOverTheSameBytesAndKey() async throws {
        let (uploader, transport, authorizer) = make()
        await transport.set(answers: [(503, #"{"error":"reportStoreUnavailable"}"#), (201, accepted())])
        let id = UUID(), jpeg = Data([1, 2, 3])
        await #expect(throws: EvidencePhotoUploadError.temporarilyUnavailable) {
            try await uploader.upload(reportID: reportID, attachmentID: id, jpeg: jpeg, acceptedTermsVersion: terms)
        }
        try await uploader.upload(reportID: reportID, attachmentID: id, jpeg: jpeg, acceptedTermsVersion: terms)
        let payloads = await authorizer.payloads
        #expect(payloads.count == 2 && payloads[0] == payloads[1], "same idempotency key and bytes: one server photo")
        let challenges = try await transport.photoPosts.map {
            try JSONDecoder().decode(Envelope.self, from: try #require($0.httpBody)).attestation.challenge
        }
        #expect(Set(challenges).count == 2, "an assertion is never replayed")
    }

    @Test func disabledDeploymentGetsNoAssertionAndNoBytes() async throws {
        for flag in [false, nil] as [Bool?] {
            let (uploader, transport, authorizer) = make()
            await transport.set(enabled: flag)
            await #expect(throws: EvidencePhotoUploadError.disabled) {
                try await uploader.upload(reportID: reportID, attachmentID: UUID(), jpeg: Data([1]), acceptedTermsVersion: terms)
            }
            #expect(await authorizer.payloads.isEmpty)
            #expect(await transport.photoPosts.isEmpty)
        }
        let (uploader, transport, _) = make()
        await transport.set(answers: [(503, #"{"error":"photoEvidenceDisabled"}"#)])
        await #expect(throws: EvidencePhotoUploadError.disabled) {
            try await uploader.upload(reportID: reportID, attachmentID: UUID(), jpeg: Data([1]), acceptedTermsVersion: terms)
        }
    }

    @Test func oversizedPhotoIsRefusedBeforeConfigOrSigning() async throws {
        let (uploader, transport, authorizer) = make()
        await #expect(throws: EvidencePhotoUploadError.tooLarge) {
            try await uploader.upload(reportID: reportID, attachmentID: UUID(),
                                      jpeg: Data(count: AttestedEvidencePhotoUploader.maxImageBytes + 1), acceptedTermsVersion: terms)
        }
        #expect(await transport.requests.isEmpty)
        #expect(await authorizer.payloads.isEmpty)
        // The largest accepted original still fits the Worker's envelope bound.
        let payload = try AttestedEvidencePhotoUploader.payload(reportID: reportID, attachmentID: UUID(),
            jpeg: Data(count: AttestedEvidencePhotoUploader.maxImageBytes), acceptedTermsVersion: terms)
        #expect(payload.count <= AttestedEvidencePhotoUploader.maxPayloadBytes)
        #expect(AttestedEvidencePhotoUploader.maxSubmissionBytes == 9_326_140)
    }

    @Test func documentedAnswersMapToRetryableOrFinalFailures() async throws {
        let cases: [(Int, String, EvidencePhotoUploadError)] = [
            (403, #"{"error":"photoUnauthorized"}"#, .unauthorized),
            (403, #"{"error":"photoConsentRequired"}"#, .unauthorized),
            (404, #"{"error":"reportNotFound"}"#, .reportNotFound),
            (409, #"{"error":"photoAttachmentLimit"}"#, .attachmentLimit),
            (409, #"{"error":"photoIdempotencyConflict"}"#, .idempotencyConflict),
            (409, #"{"error":"termsVersionOutdated"}"#, .termsOutdated),
            (410, #"{"error":"reportExpired"}"#, .expired),
            (410, #"{"error":"photoExpired"}"#, .expired),
            (413, #"{"error":"photoTooLarge"}"#, .tooLarge),
            (413, #"{"error":"photo_too_large"}"#, .tooLarge),
            (415, #"{"error":"unsupported_photo_type"}"#, .invalidImage),
            (422, #"{"error":"photo_dimensions_exceeded"}"#, .invalidImage),
            (400, #"{"error":"invalidPhoto"}"#, .invalidImage),
            (429, #"{"error":"reportRateLimited"}"#, .rateLimited(30)),
            (503, #"{"error":"attestationUnavailable"}"#, .temporarilyUnavailable),
            (500, "", .temporarilyUnavailable),
            (201, #"{"schemaVersion":2,"photoId":"ph_1","reportId":"rp_other","state":"pending"}"#, .temporarilyUnavailable),
        ]
        for (status, body, expected) in cases {
            let (uploader, transport, _) = make()
            await transport.set(answers: [(status, body)])
            await #expect(throws: expected, "\(status) \(body)") {
                try await uploader.upload(reportID: reportID, attachmentID: UUID(), jpeg: Data([1]), acceptedTermsVersion: terms)
            }
        }
        #expect(EvidencePhotoUploadError.rateLimited(nil).isRetryable)
        #expect(!EvidencePhotoUploadError.expired.isRetryable && !EvidencePhotoUploadError.unauthorized.isRetryable)
        let (uploader, transport, _) = make()
        await transport.set(answers: [(201, accepted(state: "approved"))])
        try await uploader.upload(reportID: reportID, attachmentID: UUID(), jpeg: Data([1]), acceptedTermsVersion: terms)
    }

    @Test func networkFailureIsRetryable() async {
        let (uploader, transport, _) = make()
        await transport.set(throwsOnPhoto: true)
        await #expect(throws: EvidencePhotoUploadError.temporarilyUnavailable) {
            try await uploader.upload(reportID: reportID, attachmentID: UUID(), jpeg: Data([1]), acceptedTermsVersion: terms)
        }
    }

    @Test func appAttestRefusalsReachTheAuthorizerAndOnlyStaleChallengesRetry() async throws {
        let retryable: [(String, String?, EvidencePhotoUploadError)] = [
            ("challengeInvalid", nil, .authorizationFailed(retryable: true)),
            ("counterNotIncreasing", nil, .authorizationFailed(retryable: true)),
            ("keyRevoked", nil, .authorizationFailed(retryable: false)),
            ("assertionInvalid", nil, .authorizationFailed(retryable: false)),
            ("assertionInvalid", "bundleVersion", .updateRequired),
        ]
        for (reason, detail, expected) in retryable {
            let (uploader, transport, authorizer) = make()
            let detailJSON = detail.map { #","detail":"\#($0)""# } ?? ""
            await transport.set(answers: [(403, #"{"error":"attestationRejected","reason":"\#(reason)"\#(detailJSON)}"#)])
            await #expect(throws: expected) {
                try await uploader.upload(reportID: reportID, attachmentID: UUID(), jpeg: Data([1]), acceptedTermsVersion: terms)
            }
            #expect(await authorizer.rejections.map(\.reason.rawValue) == [reason], "the key state machine sees every refusal")
        }
        let failures: [(ReportAuthorizationError, EvidencePhotoUploadError)] = [
            (.temporarilyUnavailable, .authorizationFailed(retryable: true)),
            (.busy, .authorizationFailed(retryable: true)),
            (.unsupported, .authorizationFailed(retryable: false)),
            (.registrationFailed, .authorizationFailed(retryable: false)),
            (.updateRequired, .updateRequired),
            (.challengeLimited(5), .rateLimited(5)),
        ]
        for (failure, expected) in failures {
            let (uploader, transport, authorizer) = make()
            await authorizer.set(failure: failure)
            await #expect(throws: expected) {
                try await uploader.upload(reportID: reportID, attachmentID: UUID(), jpeg: Data([1]), acceptedTermsVersion: terms)
            }
            #expect(await transport.photoPosts.isEmpty)
        }
    }
}

// MARK: - ReportPhotos with the real uploader

private actor ScriptedUploader: EvidencePhotoUploading {
    private(set) var calls: [UUID] = []
    var outcomes: [Error?] = []
    func set(outcomes: [Error?]) { self.outcomes = outcomes }
    func upload(reportID: String, attachmentID: UUID, jpeg: Data, acceptedTermsVersion: String) async throws {
        calls.append(attachmentID)
        if !outcomes.isEmpty, let error = outcomes.removeFirst() { throw error }
    }
}

struct ReportPhotosRetryTests {
    private let policy = PhotoEvidencePolicy(enabled: true, acceptedTermsVersion: terms)

    @MainActor private func png() -> Data {
        UIGraphicsImageRenderer(size: CGSize(width: 4, height: 4)).image { context in
            UIColor.gray.setFill(); context.fill(CGRect(x: 0, y: 0, width: 4, height: 4))
        }.pngData()!
    }

    @Test @MainActor func oneToThreePhotosAndAFourthIsIgnored() {
        let photos = ReportPhotos(policy: policy, uploader: ScriptedUploader())
        for _ in 0..<4 { photos.add(png()) }
        #expect(photos.photos.count == 3)
    }

    @Test @MainActor func retrySendsOnlyRetryableFailuresUnderTheSameIDs() async {
        let uploader = ScriptedUploader()
        await uploader.set(outcomes: [nil, EvidencePhotoUploadError.temporarilyUnavailable, EvidencePhotoUploadError.invalidImage])
        let photos = ReportPhotos(policy: policy, uploader: uploader)
        for _ in 0..<3 { photos.add(png()) }
        let ids = photos.photos.map(\.id)
        await photos.attach(to: reportID, acceptedTermsVersion: terms)
        #expect(photos.photos.map(\.state) == [.uploaded, .failed, .failed])
        #expect(photos.canRetry)
        await photos.retry()
        #expect(await uploader.calls == [ids[0], ids[1], ids[2], ids[1]], "uploaded and final failures are never resent")
        #expect(photos.photos.map(\.state) == [.uploaded, .uploaded, .failed])
        #expect(!photos.canRetry)
        await photos.retry()
        #expect(await uploader.calls.count == 4)
    }

    @Test @MainActor func reportLevelRefusalStopsTheRemainingPhotos() async {
        for failure in [EvidencePhotoUploadError.expired, .disabled, .unauthorized, .authorizationFailed(retryable: false)] {
            let uploader = ScriptedUploader()
            await uploader.set(outcomes: [failure])
            let photos = ReportPhotos(policy: policy, uploader: uploader)
            for _ in 0..<3 { photos.add(png()) }
            await photos.attach(to: reportID, acceptedTermsVersion: terms)
            #expect(await uploader.calls.count == 1, "\(failure)")
            #expect(photos.photos.allSatisfy { $0.state == .failed })
            #expect(!photos.canRetry)
        }
    }

    @Test @MainActor func endToEndWithTheAttestedUploaderNeverDuplicatesAPhoto() async throws {
        let transport = PhotoTransport(), authorizer = RecordingPhotoAuthorizer()
        await transport.set(answers: [(201, accepted("ph_1")), (503, #"{"error":"reportStoreUnavailable"}"#), (201, accepted("ph_2"))])
        let photos = ReportPhotos(policy: policy, uploader: AttestedEvidencePhotoUploader(
            baseURL: URL(string: "https://api.example.invalid")!, authorizer: authorizer, transport: transport))
        photos.add(png()); photos.add(png())
        await photos.attach(to: reportID, acceptedTermsVersion: terms)
        #expect(photos.photos.map(\.state) == [.uploaded, .failed])
        await photos.retry()
        #expect(photos.photos.map(\.state) == [.uploaded, .uploaded])
        let keys = try await authorizer.payloads.map {
            try #require(JSONSerialization.jsonObject(with: $0) as? [String: Any])["idempotencyKey"] as? String
        }
        #expect(keys == [photos.photos[0].id, photos.photos[1].id, photos.photos[1].id].map { $0.uuidString.lowercased() })
        #expect(await transport.requests.allSatisfy { $0.url?.path != "/v1/reports" }, "the report is never resent")
    }
}
