import Foundation

nonisolated protocol NearbyTileRefreshing: Sendable {
    func refresh(_ tile: SlippyTile) async throws
}

// Synchronizes one known tile on demand. Nearby can read GRDBTileStore while offline;
// no location, scheduling, or UI concern enters this boundary.
//
// With a config fetcher (the app), the data zoom and delivery come from GET /v1/config (Issue #158): the store's
// namespace follows the configured zoom and body schema, and a deployment that advertises tileDelivery is read
// through its manifest and EVERY part, verified, then replaced atomically. Without one (older call sites and tests),
// the single-body v1 path at the compiled-in zoom is used, exactly as before.
actor TileSyncService {
    private let client: any TileFetching
    private let store: GRDBTileStore
    private let config: (any TileConfigFetching)?
    private let configTTL: TimeInterval
    private let now: @Sendable () -> Date
    private var delivery: (value: TileDeliveryConfig, fetchedAt: Date)?
    private var pendingDelivery: Task<TileDeliveryConfig, Error>?

    init(client: any TileFetching, store: GRDBTileStore, config: (any TileConfigFetching)? = nil,
         configTTL: TimeInterval = 300, now: @escaping @Sendable () -> Date = { Date() }) {
        self.client = client
        self.store = store
        self.config = config
        self.configTTL = configTTL
        self.now = now
    }

    /// The delivery contract, fetched at most once per TTL and shared by concurrent tile refreshes. A config that
    /// cannot be read fails the refresh; the cache (and its persisted namespace) stays as it is.
    func currentDelivery() async throws -> TileDeliveryConfig {
        guard let config else {
            return TileDeliveryConfig(namespace: .legacy, manifestVersion: nil, maxPartBodyBytes: nil)
        }
        if let delivery, now().timeIntervalSince(delivery.fetchedAt) < configTTL { return delivery.value }
        if let pendingDelivery { return try await pendingDelivery.value }
        let task = Task { try await config.fetchTileDelivery() }
        pendingDelivery = task
        defer { pendingDelivery = nil }
        let value = try await task.value
        delivery = (value, now())
        return value
    }

    func sync(_ tile: SlippyTile) async throws -> CachedTile {
        let current = try await currentDelivery()
        // A tile computed for another zoom (the model has not yet seen a zoom change) is not fetched; the model
        // re-reads the store's zoom and loads the right tiles.
        guard tile.z == current.namespace.dataZoom else { throw TileSyncError.invalidTile }
        try await store.activate(current.namespace)
        let sequence = try await store.beginSync(tile)
        let existing = try await store.cachedTile(tile)
        let result: TileFetchResult
        if current.manifestVersion != nil {
            guard let multipart = client as? any MultipartTileFetching else { throw TileSyncError.invalidTile }
            result = try await multipart.fetchLogical(tile, ifNoneMatch: existing?.etag, delivery: current)
        } else {
            result = try await client.fetch(tile, ifNoneMatch: existing?.etag)
        }
        switch result {
        case .snapshot(let mapped, let etag):
            // The complete, verified logical tile replaces the previous one in one transaction.
            _ = try await store.replace(mapped, etag: etag, forSync: sequence, namespace: current.namespace)
        case .notModified:
            guard let cached = try await store.cachedTile(tile), cached.etag != nil else {
                throw TileSyncError.notModifiedWithoutCache
            }
            return cached
        case .notPublished:
            _ = try await store.clear(tile, forSync: sequence, namespace: current.namespace)
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
