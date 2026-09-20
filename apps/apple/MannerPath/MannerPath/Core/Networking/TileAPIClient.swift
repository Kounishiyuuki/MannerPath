import Foundation

private nonisolated struct TileSchemaVersion: Decodable {
    let schemaVersion: Int
}

private nonisolated struct TileProblem: Decodable {
    let error: String
    let detail: String
}

nonisolated enum TileSyncError: Error, Equatable, Sendable {
    case invalidTile
    case malformedResponse
    case missingETag
    case unsupportedSchemaVersion(Int)
    case httpStatus(Int)
    case notModifiedWithoutCache
}

nonisolated struct TileHTTPResponse: Sendable {
    let statusCode: Int
    let body: Data
    let etag: String?
}

nonisolated protocol TileHTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> TileHTTPResponse
}

nonisolated struct URLSessionTileTransport: TileHTTPTransport {
    let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    func send(_ request: URLRequest) async throws -> TileHTTPResponse {
        let (body, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else {
            throw TileSyncError.malformedResponse
        }
        return TileHTTPResponse(statusCode: response.statusCode, body: body,
                                etag: response.value(forHTTPHeaderField: "ETag"))
    }
}

nonisolated enum TileFetchResult: Sendable {
    case snapshot(MappedTile, etag: String)
    case notModified
    case notPublished
}

nonisolated protocol TileFetching: Sendable {
    func fetch(_ tile: SlippyTile, ifNoneMatch: String?) async throws -> TileFetchResult
}

nonisolated struct TileAPIClient: TileFetching {
    let baseURL: URL
    let transport: any TileHTTPTransport

    init(baseURL: URL, transport: any TileHTTPTransport = URLSessionTileTransport()) {
        self.baseURL = baseURL
        self.transport = transport
    }

    func fetch(_ tile: SlippyTile, ifNoneMatch: String?) async throws -> TileFetchResult {
        guard tile.z == SlippyTile.dataZoom else { throw TileSyncError.invalidTile }
        var request = URLRequest(url: baseURL.appending(path: "v1/tiles/\(tile.id)"))
        request.httpMethod = "GET"
        if let ifNoneMatch {
            request.setValue(ifNoneMatch, forHTTPHeaderField: "If-None-Match")
        }
        let response = try await transport.send(request)
        switch response.statusCode {
        case 200:
            guard let etag = response.etag, !etag.isEmpty else { throw TileSyncError.missingETag }
            let body: TileBodyV1
            do {
                let version = try JSONDecoder().decode(TileSchemaVersion.self, from: response.body)
                guard version.schemaVersion == 1 else {
                    throw TileSyncError.unsupportedSchemaVersion(version.schemaVersion)
                }
                body = try JSONDecoder().decode(TileBodyV1.self, from: response.body)
            } catch let error as TileSyncError {
                throw error
            } catch {
                throw TileSyncError.malformedResponse
            }
            return .snapshot(try TileSpotMapper.map(body, requestedTile: tile), etag: etag)
        case 304:
            guard response.body.isEmpty else { throw TileSyncError.malformedResponse }
            return .notModified
        case 404:
            guard let problem = try? JSONDecoder().decode(TileProblem.self, from: response.body),
                  problem.error == "tileNotPublished" else {
                throw TileSyncError.httpStatus(404)
            }
            return .notPublished
        default:
            throw TileSyncError.httpStatus(response.statusCode)
        }
    }
}
