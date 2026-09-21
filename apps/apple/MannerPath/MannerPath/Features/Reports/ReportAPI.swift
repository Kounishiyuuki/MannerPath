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
        let maxBodyBytes: Int
        let noteMaxLength: Int
    }
}

private nonisolated struct ReportProblem: Decodable { let error: String }

nonisolated protocol ReportConfigFetching: Sendable {
    func fetchAvailability() async throws -> ReportAvailability
}

nonisolated protocol ReportSubmitting: Sendable {
    func submit(_ body: Data) async throws -> AcceptedReport
}

nonisolated struct ReportAPIClient: ReportConfigFetching, ReportSubmitting {
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
        guard config.minimumSupportedSchemaVersions.report <= 1,
              config.schemaVersions.report >= 1 else { return .incompatible }
        guard config.reports.available else { return .unavailable }
        return .available(ReportLimits(noteMaxLength: config.reports.noteMaxLength,
                                       maxBodyBytes: config.reports.maxBodyBytes))
    }

    func submit(_ body: Data) async throws -> AcceptedReport {
        var request = URLRequest(url: baseURL.appending(path: "v1/reports"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        let response = try await transport.send(request)
        switch response.statusCode {
        case 201:
            guard let accepted = try? JSONDecoder().decode(AcceptedReport.self, from: response.body),
                  accepted.schemaVersion == 1, accepted.state == "pending", !accepted.reportId.isEmpty,
                  !accepted.receivedAt.isEmpty else { throw ReportAPIError.incompatibleResponse }
            return accepted
        case 429:
            let seconds = response.retryAfter.flatMap(Int.init)
            throw ReportAPIError.rateLimited(seconds)
        default:
            let code = try? JSONDecoder().decode(ReportProblem.self, from: response.body).error
            throw ReportAPIError.rejected(response.statusCode, code)
        }
    }
}
