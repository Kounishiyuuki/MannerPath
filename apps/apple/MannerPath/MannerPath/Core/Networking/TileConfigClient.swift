import Foundation

// The part of GET /v1/config (docs/API.md) that tile sync depends on. The server is the single source of truth for
// the data zoom (ADR-0015); this build syncs only when the zoom and the tile schema range are ones it understands.
private nonisolated struct TileConfigV1: Decodable {
    struct SchemaVersions: Decodable {
        let tile: Int
    }

    let schemaVersion: Int
    let dataTileZoom: Int
    let schemaVersions: SchemaVersions
    let minimumSupportedSchemaVersions: SchemaVersions
}

nonisolated protocol TileConfigFetching: Sendable {
    /// The deployment's data tile zoom, or `TileSyncError.unsupportedConfig` when this build must not sync.
    func dataTileZoom() async throws -> Int
}

nonisolated struct TileConfigClient: TileConfigFetching {
    /// Tile body schemas this build decodes: 1 (the v1 path) and 2 (manifest + parts).
    static let supportedTileSchemas = 1...2

    let baseURL: URL
    let transport: any TileHTTPTransport

    init(baseURL: URL, transport: any TileHTTPTransport = URLSessionTileTransport()) {
        self.baseURL = baseURL
        self.transport = transport
    }

    func dataTileZoom() async throws -> Int {
        var request = URLRequest(url: baseURL.appending(path: "v1/config"))
        request.httpMethod = "GET"
        let response = try await transport.send(request)
        guard response.statusCode == 200 else { throw TileSyncError.httpStatus(response.statusCode) }
        guard let config = try? JSONDecoder().decode(TileConfigV1.self, from: response.body),
              config.schemaVersion == 1 else {
            throw TileSyncError.malformedResponse
        }
        // The server serves tile schemas [minimum, current]; this build needs one of its own inside that range.
        let served = config.minimumSupportedSchemaVersions.tile...max(config.minimumSupportedSchemaVersions.tile,
                                                                     config.schemaVersions.tile)
        guard SlippyTile.supportedDataZooms.contains(config.dataTileZoom),
              served.overlaps(Self.supportedTileSchemas) else {
            throw TileSyncError.unsupportedConfig
        }
        return config.dataTileZoom
    }
}
