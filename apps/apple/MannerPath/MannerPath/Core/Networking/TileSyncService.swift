import Foundation

nonisolated protocol NearbyTileRefreshing: Sendable {
    /// Reads the deployment's data zoom and moves the cache to it (ADR-0015). Throws, leaving the cache as it is,
    /// when the configuration is unreachable or unsupported; the caller then stays on cached tiles.
    func prepare() async throws -> Int
    func refresh(_ tile: SlippyTile) async throws
}

// Synchronizes one known tile on demand. Nearby can read GRDBTileStore while offline;
// no location, scheduling, or UI concern enters this boundary.
actor TileSyncService {
    private let client: any TileFetching
    private let store: GRDBTileStore
    private let config: (any TileConfigFetching)?

    init(client: any TileFetching, store: GRDBTileStore, config: (any TileConfigFetching)? = nil) {
        self.client = client
        self.store = store
        self.config = config
    }

    /// Without a config source the cache keeps its own namespace (tests, and builds with no API).
    func prepare() async throws -> Int {
        guard let config else { return try await store.dataZoom() }
        let zoom = try await config.dataTileZoom()
        try await store.activate(dataZoom: zoom)
        return zoom
    }

    func sync(_ tile: SlippyTile) async throws -> CachedTile {
        guard tile.z == (try await store.dataZoom()) else { throw TileSyncError.invalidTile }
        let sequence = try await store.beginSync(tile)
        let existing = try await store.cachedTile(tile)
        let result = try await client.fetch(tile, ifNoneMatch: existing?.etag)
        switch result {
        case .snapshot(let mapped, let etag):
            _ = try await store.replace(mapped, etag: etag, forSync: sequence)
        case .notModified:
            guard let cached = try await store.cachedTile(tile), cached.etag != nil else {
                throw TileSyncError.notModifiedWithoutCache
            }
            return cached
        case .notPublished:
            _ = try await store.clear(tile, forSync: sequence)
        }
        guard let cached = try await store.cachedTile(tile) else {
            throw TileSyncError.malformedResponse
        }
        return cached
    }
}

extension TileSyncService: NearbyTileRefreshing {
    func refresh(_ tile: SlippyTile) async throws {
        _ = try await sync(tile)
    }
}
