import Foundation

nonisolated struct ReportHTTPResponse: Sendable {
    let statusCode: Int
    let body: Data
    let retryAfter: String?
}

nonisolated protocol ReportHTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> ReportHTTPResponse
}

nonisolated struct URLSessionReportTransport: ReportHTTPTransport {
    let session: URLSession
    init(session: URLSession = .shared) { self.session = session }

    func send(_ request: URLRequest) async throws -> ReportHTTPResponse {
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw ReportAPIError.malformedResponse }
        return ReportHTTPResponse(statusCode: response.statusCode, body: data,
                                  retryAfter: response.value(forHTTPHeaderField: "Retry-After"))
    }
}

nonisolated enum ReportAPIError: Error, Equatable, Sendable {
    case malformedResponse, httpStatus(Int), rejected(Int, String?), rateLimited(Int?), incompatibleResponse
    /// A definite App Attest refusal (403 attestationRejected): nothing was stored, no counter moved.
    case attestationRejected(AttestationRejection)
    case challengeLimited(Int?)
}

nonisolated struct AttestationRejection: Equatable, Sendable {
    enum Reason: String, Sendable {
        case challengeInvalid, keyNotRegistered, attestationInvalid, assertionInvalid, counterNotIncreasing
    }

    let reason: Reason
    /// Only the documented `bundleVersion` value is acted on (the deployment does not accept this
    /// build); any other detail is diagnostic text, never a switch.
    let detail: String?

    var requiresAppUpdate: Bool { detail == "bundleVersion" }
}

nonisolated enum AppAttestChallengePurpose: Equatable, Sendable {
    case registration
    case report(keyId: String)
}

/// Server half of the App Attest protocol (docs/API.md "App Attest"). Values are canonical base64.
nonisolated protocol AppAttestServer: Sendable {
    func requestChallenge(_ purpose: AppAttestChallengePurpose) async throws -> String
    /// Returns normally for 201 and for 409 keyAlreadyRegistered: either way the key is usable.
    func registerKey(keyId: String, challenge: String, attestationObject: Data) async throws
}

nonisolated protocol AttestedReportSubmitting: Sendable {
    func submitAttested(_ envelope: Data) async throws -> AcceptedReport
}

private nonisolated struct ConfigBody: Decodable {
    let schemaVersion: Int
    let apiVersion: String
    let schemaVersions: Versions
    let minimumSupportedSchemaVersions: Versions
    let reports: Reports

    struct Versions: Decodable { let report: Int }
    struct Reports: Decodable {
        let available: Bool
        let attestation: String?
        let maxBodyBytes: Int
        let maxSubmissionBytes: Int?
        let noteMaxLength: Int
    }
}

private nonisolated struct ReportProblem: Decodable {
    let error: String
    let reason: String?
    let detail: String?
}

private nonisolated struct ChallengeBody: Decodable {
    let schemaVersion: Int
    let challenge: String
    let purpose: String
}

private nonisolated struct KeyRegistrationBody: Decodable {
    let schemaVersion: Int
    let keyId: String
}

nonisolated protocol ReportConfigFetching: Sendable {
    func fetchAvailability() async throws -> ReportAvailability
}

nonisolated protocol ReportSubmitting: Sendable {
    func submit(_ body: Data) async throws -> AcceptedReport
}

nonisolated struct ReportAPIClient: ReportConfigFetching, ReportSubmitting, AppAttestServer, AttestedReportSubmitting {
    let baseURL: URL
    let transport: any ReportHTTPTransport

    init(baseURL: URL, transport: any ReportHTTPTransport = URLSessionReportTransport()) {
        self.baseURL = baseURL
        self.transport = transport
    }

    func fetchAvailability() async throws -> ReportAvailability {
        var request = URLRequest(url: baseURL.appending(path: "v1/config"))
        request.httpMethod = "GET"
        let response = try await transport.send(request)
        guard response.statusCode == 200 else { throw ReportAPIError.httpStatus(response.statusCode) }
        let config: ConfigBody
        do { config = try JSONDecoder().decode(ConfigBody.self, from: response.body) }
        catch { throw ReportAPIError.malformedResponse }
        guard config.schemaVersion == 1, config.apiVersion == "v1",
              config.schemaVersions.report >= config.minimumSupportedSchemaVersions.report,
              config.reports.maxBodyBytes > 0, config.reports.noteMaxLength > 0 else {
            throw ReportAPIError.malformedResponse
        }
        // The deployment accepts exactly one report protocol (docs/API.md GET /config). A body
        // without `attestation` predates #37 and is the unattested protocol.
        let range = (config.minimumSupportedSchemaVersions.report, config.schemaVersions.report)
        let submissionProtocol: ReportProtocol
        switch (config.reports.attestation ?? "none", range) {
        case ("none", (1, 1)): submissionProtocol = .unattested
        case ("appAttest", (2, 2)): submissionProtocol = .appAttest
        default: return .incompatible
        }
        guard config.reports.available else { return .unavailable }
        let maxSubmissionBytes = config.reports.maxSubmissionBytes ?? config.reports.maxBodyBytes
        guard maxSubmissionBytes >= config.reports.maxBodyBytes else { throw ReportAPIError.malformedResponse }
        return .available(ReportLimits(noteMaxLength: config.reports.noteMaxLength,
                                       maxBodyBytes: config.reports.maxBodyBytes,
                                       submissionProtocol: submissionProtocol,
                                       maxSubmissionBytes: maxSubmissionBytes))
    }

    func submit(_ body: Data) async throws -> AcceptedReport {
        try await postReport(body, schemaVersion: 1)
    }

    func submitAttested(_ envelope: Data) async throws -> AcceptedReport {
        try await postReport(envelope, schemaVersion: 2)
    }

    /// Only a contract-valid 201 proves acceptance and only documented pre-store refusals are
    /// definite; everything else is transport-ambiguous (`incompatibleResponse`).
    private func postReport(_ body: Data, schemaVersion: Int) async throws -> AcceptedReport {
        let response = try await transport.send(post("v1/reports", body: body))
        let problem = try? JSONDecoder().decode(ReportProblem.self, from: response.body)
        switch response.statusCode {
        case 201:
            guard let accepted = try? JSONDecoder().decode(AcceptedReport.self, from: response.body),
                  accepted.schemaVersion == schemaVersion, accepted.state == "pending",
                  Self.isValidReportID(accepted.reportId), Self.isValidReceivedAt(accepted.receivedAt)
            else { throw ReportAPIError.incompatibleResponse }
            return accepted
        case 403 where schemaVersion == 2:
            guard let rejection = Self.attestationRejection(problem) else { throw ReportAPIError.incompatibleResponse }
            throw ReportAPIError.attestationRejected(rejection)
        case 429:
            guard problem?.error == "reportRateLimited" else { throw ReportAPIError.incompatibleResponse }
            let seconds = response.retryAfter.flatMap(Int.init)
            throw ReportAPIError.rateLimited(seconds)
        case 400, 413, 503:
            let code = problem?.error
            let isDefinite = (response.statusCode == 400 && (code == "invalidJson" || code == "invalidReport"
                                                             || code == "reportSchemaUnsupported"))
                || (response.statusCode == 413 && code == "reportTooLarge")
                || (response.statusCode == 503 && code == "attestationUnavailable")
            guard isDefinite else { throw ReportAPIError.incompatibleResponse }
            throw ReportAPIError.rejected(response.statusCode, code)
        default:
            throw ReportAPIError.incompatibleResponse
        }
    }

    func requestChallenge(_ purpose: AppAttestChallengePurpose) async throws -> String {
        let body: [String: Any]
        let purposeName: String
        switch purpose {
        case .registration:
            purposeName = "registration"
            body = ["schemaVersion": 1, "purpose": purposeName]
        case .report(let keyId):
            purposeName = "report"
            body = ["schemaVersion": 1, "purpose": purposeName, "keyId": keyId]
        }
        let response = try await transport.send(post("v1/app-attest/challenges",
                                                      body: try JSONSerialization.data(withJSONObject: body)))
        let problem = try? JSONDecoder().decode(ReportProblem.self, from: response.body)
        switch response.statusCode {
        case 201:
            guard let issued = try? JSONDecoder().decode(ChallengeBody.self, from: response.body),
                  issued.schemaVersion == 1, issued.purpose == purposeName,
                  Data(base64Encoded: issued.challenge)?.count == 32
            else { throw ReportAPIError.malformedResponse }
            return issued.challenge
        case 403:
            guard let rejection = Self.attestationRejection(problem) else { throw ReportAPIError.httpStatus(403) }
            throw ReportAPIError.attestationRejected(rejection)
        case 429 where problem?.error == "challengeLimited":
            throw ReportAPIError.challengeLimited(response.retryAfter.flatMap(Int.init))
        case 503 where problem?.error == "attestationUnavailable":
            throw ReportAPIError.rejected(503, "attestationUnavailable")
        default:
            throw ReportAPIError.httpStatus(response.statusCode)
        }
    }

    func registerKey(keyId: String, challenge: String, attestationObject: Data) async throws {
        let body = try JSONSerialization.data(withJSONObject: [
            "schemaVersion": 1, "keyId": keyId, "challenge": challenge,
            "attestationObject": attestationObject.base64EncodedString()
        ] as [String: Any])
        let response = try await transport.send(post("v1/app-attest/keys", body: body))
        let problem = try? JSONDecoder().decode(ReportProblem.self, from: response.body)
        switch response.statusCode {
        case 201:
            guard let registered = try? JSONDecoder().decode(KeyRegistrationBody.self, from: response.body),
                  registered.schemaVersion == 1, registered.keyId == keyId
            else { throw ReportAPIError.malformedResponse }
        case 409 where problem?.error == "keyAlreadyRegistered":
            return
        case 403:
            guard let rejection = Self.attestationRejection(problem) else { throw ReportAPIError.httpStatus(403) }
            throw ReportAPIError.attestationRejected(rejection)
        case 400 where problem?.error == "invalidKeyRegistration":
            throw ReportAPIError.rejected(400, "invalidKeyRegistration")
        case 503 where problem?.error == "attestationUnavailable":
            throw ReportAPIError.rejected(503, "attestationUnavailable")
        default:
            throw ReportAPIError.httpStatus(response.statusCode)
        }
    }

    private func post(_ path: String, body: Data) -> URLRequest {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        return request
    }

    private static func attestationRejection(_ problem: ReportProblem?) -> AttestationRejection? {
        guard let problem, problem.error == "attestationRejected",
              let reason = problem.reason.flatMap(AttestationRejection.Reason.init(rawValue:)) else { return nil }
        return AttestationRejection(reason: reason, detail: problem.detail)
    }

    private static func isValidReportID(_ value: String) -> Bool {
        value.range(of: #"^rp_[0-9A-HJKMNP-TV-Z]{26}$"#, options: .regularExpression) != nil
    }

    private static func isValidReceivedAt(_ value: String) -> Bool {
        guard value.range(of: #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$"#,
                          options: .regularExpression) != nil else { return false }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = value.contains(".") ? [.withInternetDateTime, .withFractionalSeconds]
                                                   : [.withInternetDateTime]
        return formatter.date(from: value) != nil
    }
}
