import CryptoKit
import Foundation

// Scalable tile delivery v2 (Issue #158; docs/API.md "Tile manifest and parts").
//
// A LOGICAL tile is delivered as one or more PHYSICAL parts listed by a manifest. Each part is an ordinary
// schemaVersion-1 tile body holding a disjoint, id-ordered subset of the tile's spots and the sources they cite. The
// client fetches the manifest and EVERY part, verifies each one (byte length, SHA-256, tile, revision, count, order),
// assembles the logical tile, and only then hands it to the cache, which replaces the previous complete tile in one
// transaction. Any failure leaves the previous complete tile untouched: a half-updated tile is never visible.

/// What the cache is keyed by: the data zoom and the logical tile body schema. Transport details (manifest version,
/// part count) are deliberately NOT part of it, so a v1 single-body cache stays valid when the server starts serving
/// manifests for the same zoom and body schema, and stays usable offline across that upgrade.
nonisolated struct TileCacheNamespace: Equatable, Hashable, Sendable {
    let dataZoom: Int
    let tileSchemaVersion: Int

    var key: String { "z\(dataZoom)-s\(tileSchemaVersion)" }

    /// The single-body v1 cache every earlier build wrote (zoom 14, body schema 1).
    static let legacy = TileCacheNamespace(dataZoom: SlippyTile.dataZoom, tileSchemaVersion: 1)

    static func parse(key: String) -> TileCacheNamespace? {
        let parts = key.split(separator: "-")
        guard parts.count == 2, parts[0].first == "z", parts[1].first == "s",
              let zoom = Int(parts[0].dropFirst()), let schema = Int(parts[1].dropFirst()),
              (0...SlippyTile.maximumZoom).contains(zoom), schema >= 1 else { return nil }
        return TileCacheNamespace(dataZoom: zoom, tileSchemaVersion: schema)
    }
}

/// How this deployment delivers tiles, from GET /v1/config.
nonisolated struct TileDeliveryConfig: Equatable, Sendable {
    let namespace: TileCacheNamespace
    /// The manifest version, or nil when the server serves single bodies only (a deployment before tileDelivery).
    let manifestVersion: Int?
    /// The server's hard per-part body budget, when it states one.
    let maxPartBodyBytes: Int?

    static let supportedManifestVersion = 1
    static let supportedTileSchemaVersion = 1
}

nonisolated protocol TileConfigFetching: Sendable {
    func fetchTileDelivery() async throws -> TileDeliveryConfig
}

private nonisolated struct ConfigTileFieldsV1: Decodable {
    nonisolated struct Versions: Decodable { let tile: Int }
    nonisolated struct Delivery: Decodable {
        let manifestVersion: Int
        let partSchemaVersion: Int
        let maxPartBodyBytes: Int
        let maxPartSpots: Int
    }
    let schemaVersion: Int
    let dataTileZoom: Int
    let schemaVersions: Versions
    let minimumSupportedSchemaVersions: Versions
    let tileDelivery: Delivery?
}

/// Reads the tile delivery contract from GET /v1/config. Fails closed on anything this build cannot decode, so a
/// server that changes zoom or schema is never read with the wrong decoder.
nonisolated struct TileConfigClient: TileConfigFetching {
    let baseURL: URL
    let transport: any TileHTTPTransport

    init(baseURL: URL, transport: any TileHTTPTransport = URLSessionTileTransport()) {
        self.baseURL = baseURL
        self.transport = transport
    }

    func fetchTileDelivery() async throws -> TileDeliveryConfig {
        var request = URLRequest(url: baseURL.appending(path: "v1/config"))
        request.httpMethod = "GET"
        let response = try await transport.send(request)
        guard response.statusCode == 200 else { throw TileSyncError.httpStatus(response.statusCode) }
        let config: ConfigTileFieldsV1
        do { config = try JSONDecoder().decode(ConfigTileFieldsV1.self, from: response.body) } catch {
            throw TileSyncError.malformedResponse
        }
        return try Self.delivery(from: config)
    }

    fileprivate static func delivery(from config: ConfigTileFieldsV1) throws -> TileDeliveryConfig {
        guard config.schemaVersion == 1, (0...SlippyTile.maximumZoom).contains(config.dataTileZoom) else {
            throw TileSyncError.malformedResponse
        }
        // This build decodes tile body schema 1. A deployment whose minimum is newer needs an app update.
        let schema = TileDeliveryConfig.supportedTileSchemaVersion
        guard config.minimumSupportedSchemaVersions.tile <= schema, config.schemaVersions.tile >= schema else {
            throw TileSyncError.unsupportedSchemaVersion(config.minimumSupportedSchemaVersions.tile)
        }
        let namespace = TileCacheNamespace(dataZoom: config.dataTileZoom, tileSchemaVersion: schema)
        guard let delivery = config.tileDelivery else {
            return TileDeliveryConfig(namespace: namespace, manifestVersion: nil, maxPartBodyBytes: nil)
        }
        guard delivery.manifestVersion == TileDeliveryConfig.supportedManifestVersion,
              delivery.partSchemaVersion == schema, delivery.maxPartBodyBytes > 0, delivery.maxPartSpots > 0 else {
            throw TileSyncError.unsupportedSchemaVersion(delivery.manifestVersion)
        }
        return TileDeliveryConfig(namespace: namespace, manifestVersion: delivery.manifestVersion,
                                  maxPartBodyBytes: delivery.maxPartBodyBytes)
    }
}

extension TileConfigClient {
    /// Test seam: the same validation over a config JSON body.
    nonisolated static func delivery(fromConfigJSON data: Data) throws -> TileDeliveryConfig {
        let config: ConfigTileFieldsV1
        do { config = try JSONDecoder().decode(ConfigTileFieldsV1.self, from: data) } catch {
            throw TileSyncError.malformedResponse
        }
        return try delivery(from: config)
    }
}

nonisolated struct TileManifestPartV1: Decodable, Sendable, Equatable {
    let index: Int
    let spotCount: Int
    let byteLength: Int
    let sha256: String
}

nonisolated struct TileManifestV1: Decodable, Sendable, Equatable {
    let manifestVersion: Int
    let tile: String
    let revision: Int
    let generatedAt: String
    let partSchemaVersion: Int
    let spotCount: Int
    let partCount: Int
    let logicalSha256: String
    let parts: [TileManifestPartV1]

    /// An upper bound on parts a manifest may list, so a hostile manifest cannot make the client issue unbounded
    /// requests. The server's own bound is far lower (its manifest must fit one bounded row).
    static let maximumParts = 1_024

    /// Structural validation against the requested tile, before any part is fetched.
    func validated(for tile: SlippyTile, delivery: TileDeliveryConfig) throws -> Self {
        let hex = { (s: String) in s.utf8.count == 64 && s.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) } }
        guard manifestVersion == TileDeliveryConfig.supportedManifestVersion,
              partSchemaVersion == delivery.namespace.tileSchemaVersion,
              self.tile == tile.id, revision >= 1,
              (1...Self.maximumParts).contains(partCount), parts.count == partCount,
              parts.enumerated().allSatisfy({ $0.offset == $0.element.index }),
              parts.allSatisfy({ $0.spotCount >= 0 && $0.byteLength > 0 && hex($0.sha256) }),
              parts.reduce(0, { $0 + $1.spotCount }) == spotCount, hex(logicalSha256) else {
            throw TileSyncError.malformedResponse
        }
        if let budget = delivery.maxPartBodyBytes, parts.contains(where: { $0.byteLength > budget }) {
            throw TileSyncError.malformedResponse
        }
        return self
    }
}

nonisolated enum TilePartAssembler {
    static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    /// Verifies every part body against its manifest entry and assembles the complete logical tile body. Throws on a
    /// missing, extra, reordered, duplicated, corrupted or wrong-revision part; it never returns a partial tile.
    static func assemble(manifest: TileManifestV1, partBodies: [Data]) throws -> TileBodyV1 {
        guard partBodies.count == manifest.partCount else { throw TileSyncError.malformedResponse }
        var spots: [TileSpotV1] = []
        var sources: [String: TileSourceV1] = [:]
        let decoder = JSONDecoder()
        for (entry, data) in zip(manifest.parts, partBodies) {
            guard data.count == entry.byteLength, sha256Hex(data) == entry.sha256 else {
                throw TileSyncError.malformedResponse
            }
            let body: TileBodyV1
            do { body = try decoder.decode(TileBodyV1.self, from: data) } catch { throw TileSyncError.malformedResponse }
            guard body.schemaVersion == manifest.partSchemaVersion, body.tile == manifest.tile,
                  body.revision == manifest.revision, body.spots.count == entry.spotCount else {
                throw TileSyncError.malformedResponse
            }
            for source in body.sources {
                if let known = sources[source.id] {
                    guard known.displayName == source.displayName, known.licenseName == source.licenseName,
                          known.licenseUrl == source.licenseUrl, known.attributionText == source.attributionText else {
                        throw TileSyncError.malformedResponse
                    }
                } else {
                    sources[source.id] = source
                }
            }
            spots.append(contentsOf: body.spots)
        }
        // Parts are disjoint and id-ordered: the concatenation is strictly increasing, and complete.
        for index in spots.indices.dropFirst() where !(spots[index - 1].id < spots[index].id) {
            throw TileSyncError.malformedResponse
        }
        guard spots.count == manifest.spotCount else { throw TileSyncError.malformedResponse }
        return TileBodyV1(schemaVersion: manifest.partSchemaVersion, tile: manifest.tile, revision: manifest.revision,
                          generatedAt: manifest.generatedAt, spots: spots,
                          sources: sources.values.sorted { $0.id < $1.id })
    }
}

/// Fetches a complete logical tile through its manifest and parts.
nonisolated protocol MultipartTileFetching: Sendable {
    func fetchLogical(_ tile: SlippyTile, ifNoneMatch: String?, delivery: TileDeliveryConfig) async throws -> TileFetchResult
}

private nonisolated struct TileProblemBody: Decodable {
    let error: String
}

extension TileAPIClient: MultipartTileFetching {
    nonisolated func fetchLogical(_ tile: SlippyTile, ifNoneMatch: String?, delivery: TileDeliveryConfig) async throws -> TileFetchResult {
        guard tile.z == delivery.namespace.dataZoom else { throw TileSyncError.invalidTile }
        var request = URLRequest(url: baseURL.appending(path: "v1/tiles/\(tile.id)/manifest"))
        request.httpMethod = "GET"
        if let ifNoneMatch { request.setValue(ifNoneMatch, forHTTPHeaderField: "If-None-Match") }
        let response = try await transport.send(request)
        switch response.statusCode {
        case 200:
            guard let etag = response.etag, !etag.isEmpty else { throw TileSyncError.missingETag }
            let manifest: TileManifestV1
            do { manifest = try JSONDecoder().decode(TileManifestV1.self, from: response.body) } catch {
                throw TileSyncError.malformedResponse
            }
            let valid = try manifest.validated(for: tile, delivery: delivery)
            var bodies: [Data] = []
            bodies.reserveCapacity(valid.partCount)
            for part in valid.parts {
                var partRequest = URLRequest(url: baseURL.appending(path: "v1/tiles/\(tile.id)/parts/\(part.index)"))
                partRequest.httpMethod = "GET"
                let partResponse = try await transport.send(partRequest)
                // A part that is gone (the tile was republished meanwhile) or unexpected fails the whole tile; the
                // previous complete tile stays cached and the next refresh reads the new manifest.
                guard partResponse.statusCode == 200 else { throw TileSyncError.httpStatus(partResponse.statusCode) }
                bodies.append(partResponse.body)
            }
            let logical = try TilePartAssembler.assemble(manifest: valid, partBodies: bodies)
            return .snapshot(try TileSpotMapper.map(logical, requestedTile: tile), etag: etag)
        case 304:
            guard response.body.isEmpty else { throw TileSyncError.malformedResponse }
            return .notModified
        case 404:
            guard let problem = try? JSONDecoder().decode(TileProblemBody.self, from: response.body),
                  problem.error == "tileNotPublished" else {
                throw TileSyncError.httpStatus(404)
            }
            return .notPublished
        default:
            throw TileSyncError.httpStatus(response.statusCode)
        }
    }
}
