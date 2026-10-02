import Foundation
import GRDB

nonisolated struct CachedTile: Sendable {
    let tileID: String
    let revision: Int?
    let generatedAt: Date?
    let etag: String?
    let sources: [SpotSource]
    let spots: [Spot]
}

nonisolated enum TileCacheError: Error, Equatable, Sendable {
    /// The cache namespace changed while a sync was in flight; its result belongs to the old namespace.
    case namespaceChanged
}

// Tile ownership keeps replacement and removal local to one partition. Source metadata
// is stored with the tile, while each resolved spot is an independent cache record.
//
// Every cached tile belongs to a namespace (data zoom + tile body schema, Issue #158). Reads see only the active
// namespace, which is persisted, so an offline launch keeps reading what the last configured server delivered. A
// replacement is one transaction that swaps a complete logical tile, never a part of one.
actor GRDBTileStore: CachedSpotRepository {
    private let database: DatabaseQueue
    private var syncSequence: UInt64 = 0
    private var latestAppliedSyncByTile: [String: UInt64] = [:]
    private(set) var activeNamespace: TileCacheNamespace = .legacy

    init(path: String) throws {
        database = try DatabaseQueue(path: path)
        var migrator = DatabaseMigrator()
        migrator.registerMigration("tile-cache-v1") { db in
            try db.create(table: "cached_tiles") { table in
                table.column("tile_id", .text).primaryKey()
                table.column("revision", .integer)
                table.column("generated_at", .double)
                table.column("etag", .text)
                table.column("sources_json", .blob).notNull()
            }
            try db.create(table: "cached_tile_spots") { table in
                table.column("tile_id", .text).notNull()
                    .references("cached_tiles", onDelete: .cascade)
                table.column("spot_id", .text).notNull()
                table.column("spot_json", .blob).notNull()
                table.primaryKey(["tile_id", "spot_id"])
            }
        }
        // Issue #158: rows written by earlier builds are the zoom-14, body-schema-1 cache (TileCacheNamespace.legacy),
        // so an upgrade keeps the offline cache instead of discarding it.
        migrator.registerMigration("tile-cache-v2-namespace") { db in
            try db.alter(table: "cached_tiles") { table in
                table.add(column: "namespace", .text).notNull().defaults(to: TileCacheNamespace.legacy.key)
            }
            try db.create(table: "cache_meta") { table in
                table.column("key", .text).primaryKey()
                table.column("value", .text).notNull()
            }
        }
        try migrator.migrate(database)
        let stored = try database.read { db in
            try String.fetchOne(db, sql: "SELECT value FROM cache_meta WHERE key = 'active_namespace'")
        }
        activeNamespace = stored.flatMap(TileCacheNamespace.parse(key:)) ?? .legacy
    }

    func dataZoom() -> Int { activeNamespace.dataZoom }

    /// Makes `namespace` the one reads see, persisting it. Switching never deletes the previous namespace's tiles
    /// (their ids differ when the zoom differs; a same-zoom row is overwritten only by a complete replacement).
    func activate(_ namespace: TileCacheNamespace) throws {
        guard namespace != activeNamespace else { return }
        try database.write { db in
            try db.execute(sql: """
                INSERT INTO cache_meta (key, value) VALUES ('active_namespace', ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """, arguments: [namespace.key])
        }
        activeNamespace = namespace
        latestAppliedSyncByTile = [:]
    }

    func cachedTile(_ tile: SlippyTile) throws -> CachedTile? {
        guard tile.z == activeNamespace.dataZoom else { throw TileSyncError.invalidTile }
        let namespace = activeNamespace.key
        return try database.read { db in
            guard let row = try Row.fetchOne(db, sql: """
                SELECT revision, generated_at, etag, sources_json
                FROM cached_tiles WHERE tile_id = ? AND namespace = ?
                """, arguments: [tile.id, namespace]) else { return nil }
            let sourcesData: Data = row["sources_json"]
            let sources = try JSONDecoder().decode([SpotSource].self, from: sourcesData)
            let spotRows = try Row.fetchAll(db, sql: """
                SELECT spot_json FROM cached_tile_spots WHERE tile_id = ? ORDER BY spot_id
                """, arguments: [tile.id])
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            let spots = try spotRows.map { row -> Spot in
                let data: Data = row["spot_json"]
                return try decoder.decode(Spot.self, from: data)
            }
            let generatedAtSeconds: Double? = row["generated_at"]
            return CachedTile(
                tileID: tile.id,
                revision: row["revision"],
                generatedAt: generatedAtSeconds.map(Date.init(timeIntervalSince1970:)),
                etag: row["etag"],
                sources: sources,
                spots: spots
            )
        }
    }

    func spots(inTile tileID: String) throws -> [Spot] {
        guard let tile = SlippyTile.parse(id: tileID), tile.z == activeNamespace.dataZoom else {
            throw TileSyncError.invalidTile
        }
        return try cachedTile(tile)?.spots ?? []
    }

    func sources(inTile tileID: String) throws -> [SpotSource] {
        guard let tile = SlippyTile.parse(id: tileID), tile.z == activeNamespace.dataZoom else {
            throw TileSyncError.invalidTile
        }
        return try cachedTile(tile)?.sources ?? []
    }

    // Request order matters only after a response has committed. A newer failed
    // request must not suppress a still-valid older response.
    func beginSync(_ tile: SlippyTile) throws -> UInt64 {
        guard tile.z == activeNamespace.dataZoom else { throw TileSyncError.invalidTile }
        syncSequence &+= 1
        return syncSequence
    }

    /// Replaces the complete logical tile only if `namespace` is still active (a config change mid-flight voids it).
    func replace(_ tile: MappedTile, etag: String, forSync sequence: UInt64, namespace: TileCacheNamespace) throws -> Bool {
        guard namespace == activeNamespace else { throw TileCacheError.namespaceChanged }
        return try replace(tile, etag: etag, forSync: sequence)
    }

    func clear(_ tile: SlippyTile, forSync sequence: UInt64, namespace: TileCacheNamespace) throws -> Bool {
        guard namespace == activeNamespace else { throw TileCacheError.namespaceChanged }
        return try clear(tile, forSync: sequence)
    }

    func replace(_ tile: MappedTile, etag: String, forSync sequence: UInt64) throws -> Bool {
        guard sequence > (latestAppliedSyncByTile[tile.tileID] ?? 0) else { return false }
        try replace(tile, etag: etag)
        latestAppliedSyncByTile[tile.tileID] = sequence
        return true
    }

    func clear(_ tile: SlippyTile, forSync sequence: UInt64) throws -> Bool {
        guard sequence > (latestAppliedSyncByTile[tile.id] ?? 0) else { return false }
        try clear(tile)
        latestAppliedSyncByTile[tile.id] = sequence
        return true
    }

    func replace(_ tile: MappedTile, etag: String) throws {
        let sourcesData = try JSONEncoder().encode(tile.sources)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let spotRows = try tile.spots.map { ($0.id, try encoder.encode($0)) }
        guard let parsed = SlippyTile.parse(id: tile.tileID), parsed.z == activeNamespace.dataZoom else {
            throw TileSyncError.invalidTile
        }
        let namespace = activeNamespace.key
        // One transaction: the previous complete tile is visible until the new complete tile commits.
        try database.write { db in
            try db.execute(sql: "DELETE FROM cached_tile_spots WHERE tile_id = ?", arguments: [tile.tileID])
            try db.execute(sql: """
                INSERT INTO cached_tiles (tile_id, revision, generated_at, etag, sources_json, namespace)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(tile_id) DO UPDATE SET
                  revision = excluded.revision,
                  generated_at = excluded.generated_at,
                  etag = excluded.etag,
                  sources_json = excluded.sources_json,
                  namespace = excluded.namespace
                """, arguments: [tile.tileID, tile.revision,
                                  tile.generatedAt.timeIntervalSince1970, etag, sourcesData, namespace])
            for (id, data) in spotRows {
                try db.execute(sql: """
                    INSERT INTO cached_tile_spots (tile_id, spot_id, spot_json) VALUES (?, ?, ?)
                    """, arguments: [tile.tileID, id, data])
            }
        }
    }

    func clear(_ tile: SlippyTile) throws {
        guard tile.z == activeNamespace.dataZoom else { throw TileSyncError.invalidTile }
        let emptySources = try JSONEncoder().encode([SpotSource]())
        let namespace = activeNamespace.key
        try database.write { db in
            try db.execute(sql: "DELETE FROM cached_tile_spots WHERE tile_id = ?", arguments: [tile.id])
            try db.execute(sql: """
                INSERT INTO cached_tiles (tile_id, revision, generated_at, etag, sources_json, namespace)
                VALUES (?, NULL, NULL, NULL, ?, ?)
                ON CONFLICT(tile_id) DO UPDATE SET
                  revision = NULL, generated_at = NULL, etag = NULL,
                  sources_json = excluded.sources_json, namespace = excluded.namespace
                """, arguments: [tile.id, emptySources, namespace])
        }
    }
}
