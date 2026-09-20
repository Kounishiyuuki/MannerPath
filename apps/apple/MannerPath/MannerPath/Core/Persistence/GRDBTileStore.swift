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
actor GRDBTileStore: CachedSpotRepository {
    private let database: DatabaseQueue
    private var syncSequence: UInt64 = 0
    private var latestAppliedSyncByTile: [String: UInt64] = [:]

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
        try migrator.migrate(database)
    }

    func cachedTile(_ tile: SlippyTile) throws -> CachedTile? {
        guard tile.z == SlippyTile.dataZoom else { throw TileSyncError.invalidTile }
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
        guard let tile = SlippyTile.parse(id: tileID), tile.z == SlippyTile.dataZoom else {
            throw TileSyncError.invalidTile
        }
        return try cachedTile(tile)?.spots ?? []
    }

    // Request order matters only after a response has committed. A newer failed
    // request must not suppress a still-valid older response.
    func beginSync(_ tile: SlippyTile) throws -> UInt64 {
        guard tile.z == SlippyTile.dataZoom else { throw TileSyncError.invalidTile }
        syncSequence &+= 1
        return syncSequence
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
        guard tile.z == SlippyTile.dataZoom else { throw TileSyncError.invalidTile }
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
