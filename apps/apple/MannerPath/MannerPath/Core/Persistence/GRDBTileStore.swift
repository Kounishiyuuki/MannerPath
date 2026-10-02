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

// Tile ownership keeps replacement and removal local to one partition. Source metadata
// is stored with the tile, while each resolved spot is an independent cache record.
// Every cached tile belongs to one namespace, the (cache schema, data zoom) it was built under (ADR-0015): tiles of
// another zoom are never mixed in, and moving to a new namespace evicts the old one in the same transaction.
actor GRDBTileStore: CachedSpotRepository {
    /// The layout and meaning of cached rows. Raise it when a cached spot written by an older build cannot be read
    /// as current; the next open then evicts everything rather than serving a mixed cache.
    static let cacheSchema = 2

    private let database: DatabaseQueue
    private var syncSequence: UInt64 = 0
    private var latestAppliedSyncByTile: [String: UInt64] = [:]
    private var zoom: Int
    /// The last sync sequence issued under a previous namespace: a sync begun at or before it can never apply.
    private var namespaceFloor: UInt64 = 0

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
        // Caches from before the namespace existed were all built at the then-fixed z14.
        migrator.registerMigration("tile-cache-v2-namespace") { db in
            try db.create(table: "cache_namespace") { table in
                table.column("id", .integer).primaryKey().check { $0 == 1 }
                table.column("cache_schema", .integer).notNull()
                table.column("tile_zoom", .integer).notNull()
            }
            try db.execute(sql: "INSERT INTO cache_namespace (id, cache_schema, tile_zoom) VALUES (1, 1, ?)",
                           arguments: [SlippyTile.defaultDataZoom])
        }
        try migrator.migrate(database)
        zoom = try database.write { db in
            let row = try Row.fetchOne(db, sql: "SELECT cache_schema, tile_zoom FROM cache_namespace WHERE id = 1")!
            let schema: Int = row["cache_schema"]
            let zoom: Int = row["tile_zoom"]
            // A v1-schema cache is the same tile content (the v1 body is the assembled tile), so it is adopted.
            if schema != Self.cacheSchema && schema != 1 {
                try db.execute(sql: "DELETE FROM cached_tiles")
            }
            try db.execute(sql: "UPDATE cache_namespace SET cache_schema = ? WHERE id = 1", arguments: [Self.cacheSchema])
            return zoom
        }
    }

    /// The data zoom the cached tiles were built at.
    func dataZoom() async throws -> Int { zoom }

    /// Moves the cache to `dataZoom`. A different zoom evicts every cached tile and the namespace change in one
    /// transaction, so a reader sees either the old world or an empty new one, never both. Returns whether it evicted.
    @discardableResult
    func activate(dataZoom newZoom: Int) throws -> Bool {
        guard SlippyTile.supportedDataZooms.contains(newZoom) else { throw TileSyncError.unsupportedConfig }
        guard newZoom != zoom else { return false }
        try database.write { db in
            try db.execute(sql: "DELETE FROM cached_tiles")
            try db.execute(sql: "UPDATE cache_namespace SET tile_zoom = ? WHERE id = 1", arguments: [newZoom])
        }
        zoom = newZoom
        namespaceFloor = syncSequence
        latestAppliedSyncByTile = [:]
        return true
    }

    func cachedTile(_ tile: SlippyTile) throws -> CachedTile? {
        guard tile.z == zoom else { throw TileSyncError.invalidTile }
        return try database.read { db in
            guard let row = try Row.fetchOne(db, sql: """
                SELECT revision, generated_at, etag, sources_json
                FROM cached_tiles WHERE tile_id = ?
                """, arguments: [tile.id]) else { return nil }
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
        guard let tile = SlippyTile.parse(id: tileID), tile.z == zoom else {
            throw TileSyncError.invalidTile
        }
        return try cachedTile(tile)?.spots ?? []
    }

    func sources(inTile tileID: String) throws -> [SpotSource] {
        guard let tile = SlippyTile.parse(id: tileID), tile.z == zoom else {
            throw TileSyncError.invalidTile
        }
        return try cachedTile(tile)?.sources ?? []
    }

    // Request order matters only after a response has committed. A newer failed
    // request must not suppress a still-valid older response.
    func beginSync(_ tile: SlippyTile) throws -> UInt64 {
        guard tile.z == zoom else { throw TileSyncError.invalidTile }
        syncSequence &+= 1
        return syncSequence
    }

    /// A response applies only within the namespace its sync began in.
    private func isCurrentNamespace(_ sequence: UInt64) -> Bool { sequence > namespaceFloor }

    func replace(_ tile: MappedTile, etag: String, forSync sequence: UInt64) throws -> Bool {
        guard isCurrentNamespace(sequence) else { return false }
        guard sequence > (latestAppliedSyncByTile[tile.tileID] ?? 0) else { return false }
        try replace(tile, etag: etag)
        latestAppliedSyncByTile[tile.tileID] = sequence
        return true
    }

    func clear(_ tile: SlippyTile, forSync sequence: UInt64) throws -> Bool {
        guard isCurrentNamespace(sequence) else { return false }
        guard sequence > (latestAppliedSyncByTile[tile.id] ?? 0) else { return false }
        try clear(tile)
        latestAppliedSyncByTile[tile.id] = sequence
        return true
    }

    func replace(_ tile: MappedTile, etag: String) throws {
        guard SlippyTile.parse(id: tile.tileID)?.z == zoom else { throw TileSyncError.invalidTile }
        let sourcesData = try JSONEncoder().encode(tile.sources)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let spotRows = try tile.spots.map { ($0.id, try encoder.encode($0)) }
        try database.write { db in
            try db.execute(sql: "DELETE FROM cached_tile_spots WHERE tile_id = ?", arguments: [tile.tileID])
            try db.execute(sql: """
                INSERT INTO cached_tiles (tile_id, revision, generated_at, etag, sources_json)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(tile_id) DO UPDATE SET
                  revision = excluded.revision,
                  generated_at = excluded.generated_at,
                  etag = excluded.etag,
                  sources_json = excluded.sources_json
                """, arguments: [tile.tileID, tile.revision,
                                  tile.generatedAt.timeIntervalSince1970, etag, sourcesData])
            for (id, data) in spotRows {
                try db.execute(sql: """
                    INSERT INTO cached_tile_spots (tile_id, spot_id, spot_json) VALUES (?, ?, ?)
                    """, arguments: [tile.tileID, id, data])
            }
        }
    }

    func clear(_ tile: SlippyTile) throws {
        guard tile.z == zoom else { throw TileSyncError.invalidTile }
        let emptySources = try JSONEncoder().encode([SpotSource]())
        try database.write { db in
            try db.execute(sql: "DELETE FROM cached_tile_spots WHERE tile_id = ?", arguments: [tile.id])
            try db.execute(sql: """
                INSERT INTO cached_tiles (tile_id, revision, generated_at, etag, sources_json)
                VALUES (?, NULL, NULL, NULL, ?)
                ON CONFLICT(tile_id) DO UPDATE SET
                  revision = NULL, generated_at = NULL, etag = NULL,
                  sources_json = excluded.sources_json
                """, arguments: [tile.id, emptySources])
        }
    }
}
