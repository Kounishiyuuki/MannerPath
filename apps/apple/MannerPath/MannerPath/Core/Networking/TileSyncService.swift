import Foundation

// Synchronizes one known tile on demand. Nearby can read GRDBTileStore while offline;
// no location, scheduling, or UI concern enters this boundary.
actor TileSyncService {
    private let client: any TileFetching
    private let store: GRDBTileStore

    init(client: any TileFetching, store: GRDBTileStore) {
        self.client = client
        self.store = store
    }

    func sync(_ tile: SlippyTile) async throws -> CachedTile {
        guard tile.z == SlippyTile.dataZoom else { throw TileSyncError.invalidTile }
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
