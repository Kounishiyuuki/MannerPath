import Foundation

/// Why one evidence photo was not received. Only `isRetryable` failures are worth the user's retry: the
/// others would fail identically (or, for the key, can never again prove ownership of the parent report).
nonisolated enum EvidencePhotoUploadError: Error, Equatable, Sendable {
    /// `GET /v1/config` does not advertise photo intake, or the route answered 503 photoEvidenceDisabled.
    case disabled
    /// Network failure, store unavailable or an undocumented answer. The idempotency key makes a retry safe.
    case temporarilyUnavailable
    case rateLimited(Int?)
    /// App Attest could not authorize this upload; `retryable` is false when only a new key could, and a new
    /// key never owns the parent report (docs/API.md: the submitter-key hash must match the parent).
    case authorizationFailed(retryable: Bool)
    case updateRequired
    /// 403 photoUnauthorized / photoConsentRequired: this device's key or consent does not own the report.
    case unauthorized
    case tooLarge
    case invalidImage
    case expired
    case reportNotFound
    case attachmentLimit
    case idempotencyConflict
    case termsOutdated

    var isRetryable: Bool {
        switch self {
        case .temporarilyUnavailable, .rateLimited: true
        case .authorizationFailed(let retryable): retryable
        default: false
        }
    }
}

/// The production `EvidencePhotoUploading` (docs/API.md "Private photo attachment foundation"): one App
/// Attest assertion per attempt over the exact payload bytes, in the report signing domain, with the
/// attachment UUID as idempotency key. A retry signs again with a fresh challenge and the same key and
/// bytes, so the server answers with the same photo; the report itself is never resent from here.
nonisolated struct AttestedEvidencePhotoUploader: EvidencePhotoUploading {
    /// docs/API.md limits: original 5 MiB; payload/envelope bounds derived exactly as the Worker does.
    static let maxImageBytes = 5 * 1024 * 1024
    static let maxPayloadBytes = (maxImageBytes + 2) / 3 * 4 + 1024
    static let maxSubmissionBytes = (maxPayloadBytes + 2) / 3 * 4 + 4096

    let baseURL: URL
    let transport: any ReportHTTPTransport
    let authorizer: any ReportAuthorizing

    init(baseURL: URL, authorizer: any ReportAuthorizing, transport: any ReportHTTPTransport = URLSessionReportTransport()) {
        self.baseURL = baseURL
        self.authorizer = authorizer
        self.transport = transport
    }

    func upload(reportID: String, attachmentID: UUID, jpeg: Data, acceptedTermsVersion: String) async throws {
        guard jpeg.count <= Self.maxImageBytes else { throw EvidencePhotoUploadError.tooLarge }
        let payload = try Self.payload(reportID: reportID, attachmentID: attachmentID, jpeg: jpeg,
                                       acceptedTermsVersion: acceptedTermsVersion)
        guard payload.count <= Self.maxPayloadBytes else { throw EvidencePhotoUploadError.tooLarge }
        // Checked before any challenge is taken: a disabled deployment never sees a key, an assertion or bytes.
        guard try await photoIntakeEnabled() else { throw EvidencePhotoUploadError.disabled }

        let authorization: ReportAuthorization
        do { authorization = try await authorizer.authorize(payload: payload) }
        catch let error as ReportAuthorizationError { throw Self.map(error) }
        catch { throw EvidencePhotoUploadError.authorizationFailed(retryable: true) }
        let body: Data
        do { body = try AttestedReportEnvelope.encoded(payload: payload, authorization: authorization, schemaVersion: 2) }
        catch { throw EvidencePhotoUploadError.authorizationFailed(retryable: true) }
        guard body.count <= Self.maxSubmissionBytes else { throw EvidencePhotoUploadError.tooLarge }

        var request = URLRequest(url: baseURL.appending(path: "v1/reports/\(reportID)/photos"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        let response: ReportHTTPResponse
        do { response = try await transport.send(request) }
        catch { throw EvidencePhotoUploadError.temporarilyUnavailable }
        try await accept(response, reportID: reportID, keyId: authorization.keyId)
    }

    /// The exact signed bytes: sorted keys, no whitespace, unescaped slashes
    /// (pinned by contracts/app-attest/photo-upload-vectors.v1.json).
    static func payload(reportID: String, attachmentID: UUID, jpeg: Data, acceptedTermsVersion: String) throws -> Data {
        struct Payload: Encodable {
            let schemaVersion = 2
            let reportId: String
            let idempotencyKey: String
            let acceptedTermsVersion: String
            let mediaType = "image/jpeg"
            let image: String
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(Payload(reportId: reportID, idempotencyKey: attachmentID.uuidString.lowercased(),
                                          acceptedTermsVersion: acceptedTermsVersion, image: jpeg.base64EncodedString()))
    }

    private func photoIntakeEnabled() async throws -> Bool {
        struct Config: Decodable {
            struct Reports: Decodable { let photoEvidenceEnabled: Bool? }
            let reports: Reports
        }
        var request = URLRequest(url: baseURL.appending(path: "v1/config"))
        request.httpMethod = "GET"
        let response: ReportHTTPResponse
        do { response = try await transport.send(request) }
        catch { throw EvidencePhotoUploadError.temporarilyUnavailable }
        guard response.statusCode == 200 else { throw EvidencePhotoUploadError.temporarilyUnavailable }
        guard let config = try? JSONDecoder().decode(Config.self, from: response.body) else {
            throw EvidencePhotoUploadError.temporarilyUnavailable
        }
        // Absence means disabled (docs/API.md).
        return config.reports.photoEvidenceEnabled == true
    }

    private func accept(_ response: ReportHTTPResponse, reportID: String, keyId: String) async throws {
        struct Accepted: Decodable { let schemaVersion: Int; let photoId: String; let reportId: String; let state: String }
        struct Problem: Decodable { let error: String; let reason: String?; let detail: String? }
        let problem = try? JSONDecoder().decode(Problem.self, from: response.body)
        switch (response.statusCode, problem?.error) {
        case (201, _):
            // A retry may return the photo's later moderation state; anything else is not this contract.
            guard let accepted = try? JSONDecoder().decode(Accepted.self, from: response.body),
                  accepted.schemaVersion == 2, accepted.reportId == reportID, !accepted.photoId.isEmpty,
                  ["pending", "approved", "rejected"].contains(accepted.state)
            else { throw EvidencePhotoUploadError.temporarilyUnavailable }
        case (403, "attestationRejected"):
            guard let reason = problem?.reason.flatMap(AttestationRejection.Reason.init(rawValue:)) else {
                throw EvidencePhotoUploadError.temporarilyUnavailable
            }
            let rejection = AttestationRejection(reason: reason, detail: problem?.detail)
            await authorizer.handleRejection(rejection, keyId: keyId)
            if rejection.requiresAppUpdate { throw EvidencePhotoUploadError.updateRequired }
            // A stale challenge or counter is fixed by signing again; any key-level refusal means a new
            // key, which cannot own the parent report.
            throw EvidencePhotoUploadError.authorizationFailed(
                retryable: reason == .challengeInvalid || reason == .counterNotIncreasing)
        case (403, "photoUnauthorized"), (403, "photoConsentRequired"): throw EvidencePhotoUploadError.unauthorized
        case (404, "reportNotFound"): throw EvidencePhotoUploadError.reportNotFound
        case (409, "photoAttachmentLimit"): throw EvidencePhotoUploadError.attachmentLimit
        case (409, "photoIdempotencyConflict"): throw EvidencePhotoUploadError.idempotencyConflict
        case (409, "termsVersionOutdated"): throw EvidencePhotoUploadError.termsOutdated
        case (410, "reportExpired"), (410, "photoExpired"): throw EvidencePhotoUploadError.expired
        case (413, _): throw EvidencePhotoUploadError.tooLarge
        case (400, "invalidPhoto"), (415, _), (422, _): throw EvidencePhotoUploadError.invalidImage
        case (429, _): throw EvidencePhotoUploadError.rateLimited(response.retryAfter.flatMap(Int.init))
        case (503, "photoEvidenceDisabled"): throw EvidencePhotoUploadError.disabled
        default:
            // Including 503 reportStoreUnavailable / attestationUnavailable: retryable under the same key.
            throw EvidencePhotoUploadError.temporarilyUnavailable
        }
    }

    private static func map(_ error: ReportAuthorizationError) -> EvidencePhotoUploadError {
        switch error {
        case .temporarilyUnavailable, .busy, .serviceUnavailable: .authorizationFailed(retryable: true)
        case .challengeLimited(let seconds): .rateLimited(seconds)
        case .updateRequired: .updateRequired
        case .unsupported, .registrationFailed: .authorizationFailed(retryable: false)
        }
    }
}
