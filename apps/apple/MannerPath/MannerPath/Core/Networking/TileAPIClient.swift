import CryptoKit
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
    /// A part did not match the manifest that listed it: the tile was republished mid-read. Nothing is applied.
    case partsChanged
    /// GET /v1/config named a zoom or tile schema range this build cannot sync. Sync stops; the cache stays readable.
    case unsupportedConfig
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
    /// ADR-0015 tile-parts.v1 maxParts: a manifest naming more is malformed.
    static let maximumParts = 128

    let baseURL: URL
    let transport: any TileHTTPTransport

    init(baseURL: URL, transport: any TileHTTPTransport = URLSessionTileTransport()) {
        self.baseURL = baseURL
        self.transport = transport
    }

    // A tile of at most one part is read at the v1 path, one request as before ADR-0015. A tile cached from parts
    // ("2-" ETag) is revalidated at its manifest; a v1 read refused with 409 tileRequiresParts switches to parts.
    func fetch(_ tile: SlippyTile, ifNoneMatch: String?) async throws -> TileFetchResult {
        guard SlippyTile.supportedDataZooms.contains(tile.z) else { throw TileSyncError.invalidTile }
        if let ifNoneMatch, ifNoneMatch.hasPrefix(#""2-"#) {
            return try await fetchParts(tile, ifNoneMatch: ifNoneMatch)
        }
        let response = try await get("v1/tiles/\(tile.id)", ifNoneMatch: ifNoneMatch)
        switch response.statusCode {
        case 200:
            guard let etag = response.etag, !etag.isEmpty else { throw TileSyncError.missingETag }
            let body = try decode(TileBodyV1.self, schemaVersion: 1, from: response.body)
            return .snapshot(try TileSpotMapper.map(body, requestedTile: tile), etag: etag)
        case 304:
            guard response.body.isEmpty else { throw TileSyncError.malformedResponse }
            return .notModified
        case 404:
            guard problem(response) == "tileNotPublished" else { throw TileSyncError.httpStatus(404) }
            return .notPublished
        case 409:
            guard problem(response) == "tileRequiresParts" else { throw TileSyncError.httpStatus(409) }
            return try await fetchParts(tile, ifNoneMatch: nil)
        default:
            throw TileSyncError.httpStatus(response.statusCode)
        }
    }

    /// Reads the manifest, then every part, and accepts the tile only when each part's bytes hash to the manifest
    /// entry: a republish between requests can never produce a mixed snapshot, only `partsChanged`.
    private func fetchParts(_ tile: SlippyTile, ifNoneMatch: String?) async throws -> TileFetchResult {
        let response = try await get("v1/tiles/\(tile.id)/manifest", ifNoneMatch: ifNoneMatch)
        switch response.statusCode {
        case 200:
            break
        case 304:
            guard response.body.isEmpty else { throw TileSyncError.malformedResponse }
            return .notModified
        case 404:
            guard problem(response) == "tileNotPublished" else { throw TileSyncError.httpStatus(404) }
            return .notPublished
        default:
            throw TileSyncError.httpStatus(response.statusCode)
        }
        guard let etag = response.etag, !etag.isEmpty else { throw TileSyncError.missingETag }
        let manifest = try decode(TileManifestV2.self, schemaVersion: 2, from: response.body)
        guard manifest.tile == tile.id,
              manifest.parts.count <= Self.maximumParts,
              manifest.parts.enumerated().allSatisfy({ $0.offset == $0.element.index && $0.element.spotCount >= 1 }),
              manifest.parts.reduce(0, { $0 + $1.spotCount }) == manifest.spotCount else {
            throw TileSyncError.malformedResponse
        }

        // Parts are independent and content-addressed, so they are fetched concurrently and assembled in index order.
        let bodies = try await withThrowingTaskGroup(of: (Int, Data).self, returning: [Data].self) { group in
            for entry in manifest.parts {
                group.addTask {
                    let response = try await get("v1/tiles/\(tile.id)/parts/\(entry.index)", ifNoneMatch: nil)
                    guard response.statusCode == 200 else {
                        if response.statusCode == 404 { throw TileSyncError.partsChanged }
                        throw TileSyncError.httpStatus(response.statusCode)
                    }
                    guard Self.sha256Hex(response.body) == entry.sha256 else { throw TileSyncError.partsChanged }
                    return (entry.index, response.body)
                }
            }
            var byIndex = [Data?](repeating: nil, count: manifest.parts.count)
            for try await (index, body) in group { byIndex[index] = body }
            return byIndex.compactMap { $0 }
        }
        guard bodies.count == manifest.parts.count else { throw TileSyncError.malformedResponse }
        var spots: [TileSpotV1] = []
        var sources: [String: TileSourceV1] = [:]
        for (entry, body) in zip(manifest.parts, bodies) {
            let part = try decode(TilePartBodyV2.self, schemaVersion: 2, from: body)
            guard part.tile == tile.id, part.part == entry.index, part.partCount == manifest.parts.count,
                  part.spots.count == entry.spotCount else {
                throw TileSyncError.malformedResponse
            }
            spots += part.spots
            for source in part.sources where sources[source.id] == nil { sources[source.id] = source }
        }
        guard Set(spots.map(\.id)).count == spots.count else { throw TileSyncError.malformedResponse }
        let whole = TileBodyV1(schemaVersion: 1, tile: manifest.tile, revision: manifest.revision,
                               generatedAt: manifest.generatedAt, spots: spots,
                               sources: sources.values.sorted { $0.id < $1.id })
        return .snapshot(try TileSpotMapper.map(whole, requestedTile: tile), etag: etag)
    }

    private func get(_ path: String, ifNoneMatch: String?) async throws -> TileHTTPResponse {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = "GET"
        if let ifNoneMatch {
            request.setValue(ifNoneMatch, forHTTPHeaderField: "If-None-Match")
        }
        return try await transport.send(request)
    }

    private func decode<Body: Decodable>(_ type: Body.Type, schemaVersion: Int, from data: Data) throws -> Body {
        do {
            let version = try JSONDecoder().decode(TileSchemaVersion.self, from: data)
            guard version.schemaVersion == schemaVersion else {
                throw TileSyncError.unsupportedSchemaVersion(version.schemaVersion)
            }
            return try JSONDecoder().decode(Body.self, from: data)
        } catch let error as TileSyncError {
            throw error
        } catch {
            throw TileSyncError.malformedResponse
        }
    }

    private func problem(_ response: TileHTTPResponse) -> String? {
        (try? JSONDecoder().decode(TileProblem.self, from: response.body))?.error
    }

    static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
