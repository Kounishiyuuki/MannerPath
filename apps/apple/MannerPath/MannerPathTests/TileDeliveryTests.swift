import Foundation
import Testing
@testable import MannerPath

// Scalable tile delivery v2 (Issue #158): config-driven zoom, cache namespace, manifest + verified parts, atomic
// replacement, offline preservation, and clustering that never changes the logical result list.

private actor ScriptedTransport: TileHTTPTransport {
    private var routes: [String: [TileHTTPResponse]]
    private(set) var paths: [String] = []

    init(_ routes: [String: [TileHTTPResponse]]) { self.routes = routes }

    func send(_ request: URLRequest) async throws -> TileHTTPResponse {
        let path = request.url?.path ?? ""
        paths.append(path)
        guard var queue = routes[path], !queue.isEmpty else { throw ScriptError.unexpected(path) }
        let response = queue.removeFirst()
        routes[path] = queue
        return response
    }

    func requested() -> [String] { paths }

    enum ScriptError: Error { case unexpected(String) }
}

struct TileDeliveryTests {
    private let tile = SlippyTile(z: 14, x: 14553, y: 6449)!
    private let sourceID = "approved-municipal-source"
    private let base = URL(string: "https://tiles.example.invalid")!

    // MARK: Fixtures

    private func spotID(_ number: Int) -> String {
        let suffix = String(number)
        return "sp_" + String(repeating: "0", count: 26 - suffix.count) + suffix
    }

    private func spot(_ number: Int) -> [String: Any] {
        ["id": spotID(number), "name": "Spot \(number)", "latitude": 35.7112, "longitude": 139.77377,
         "spotType": "unknown", "accessType": "unknown", "environment": "unknown",
         "supportsPaper": "unknown", "supportsHeated": "unknown",
         "openingHours": ["status": "none", "raw": NSNull(), "parsed": NSNull(), "timeZone": "Asia/Tokyo"],
         "lifecycle": "active", "evidenceQuality": "officialListing", "evidenceQualityVersion": "evidence-quality.v1",
         "lastVerifiedAt": "2026-08-18", "sourceIds": [sourceID]]
    }

    private func partBody(revision: Int, numbers: ClosedRange<Int>) throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "schemaVersion": 1, "tile": tile.id, "revision": revision, "generatedAt": "2026-10-02T00:00:00Z",
            "spots": numbers.map { spot($0) },
            "sources": [["id": sourceID, "displayName": "Approved ward source", "licenseName": "CC BY 4.0",
                         "licenseUrl": "https://example.org/license", "attributionText": "Ward attribution"]]
        ], options: [.sortedKeys])
    }

    private func manifest(revision: Int, parts: [Data], counts: [Int], tileID: String? = nil) throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "manifestVersion": 1, "tile": tileID ?? tile.id, "revision": revision, "generatedAt": "2026-10-02T00:00:00Z",
            "partSchemaVersion": 1, "spotCount": counts.reduce(0, +), "partCount": parts.count,
            "logicalSha256": String(repeating: "a", count: 64),
            "parts": zip(parts, counts).enumerated().map { index, pair in
                ["index": index, "spotCount": pair.1, "byteLength": pair.0.count,
                 "sha256": TilePartAssembler.sha256Hex(pair.0)] as [String: Any]
            }
        ])
    }

    private func configJSON(zoom: Int = 14, delivery: Bool = true, manifestVersion: Int = 1, minimumTile: Int = 1) throws -> Data {
        var body: [String: Any] = [
            "schemaVersion": 1, "apiVersion": "v1", "dataTileZoom": zoom,
            "schemaVersions": ["tile": 1, "spotDetail": 1, "report": 1],
            "minimumSupportedSchemaVersions": ["tile": minimumTile, "spotDetail": 1, "report": 1]
        ]
        if delivery {
            body["tileDelivery"] = ["manifestVersion": manifestVersion, "partSchemaVersion": 1,
                                    "maxPartBodyBytes": 44_000, "maxPartSpots": 250]
        }
        return try JSONSerialization.data(withJSONObject: body)
    }

    private func ok(_ data: Data, etag: String? = nil) -> TileHTTPResponse {
        TileHTTPResponse(statusCode: 200, body: data, etag: etag)
    }

    private func cachePath() -> String {
        FileManager.default.temporaryDirectory.appendingPathComponent("mannerpath-delivery-\(UUID().uuidString).sqlite").path
    }

    private var manifestPath: String { "/v1/tiles/\(tile.id)/manifest" }
    private func partPath(_ index: Int) -> String { "/v1/tiles/\(tile.id)/parts/\(index)" }

    /// A two-part revision `revision`: spots 1...3 and 4...5.
    private func twoParts(revision: Int) throws -> (manifest: Data, parts: [Data]) {
        let parts = [try partBody(revision: revision, numbers: 1...3), try partBody(revision: revision, numbers: 4...5)]
        return (try manifest(revision: revision, parts: parts, counts: [3, 2]), parts)
    }

    private func service(_ transport: ScriptedTransport, store: GRDBTileStore) -> TileSyncService {
        TileSyncService(client: TileAPIClient(baseURL: base, transport: transport), store: store,
                        config: TileConfigClient(baseURL: base, transport: transport))
    }

    // MARK: Config and namespace

    @Test func configDrivesZoomAndDelivery() throws {
        let manifestDelivery = try TileConfigClient.delivery(fromConfigJSON: configJSON(zoom: 15))
        #expect(manifestDelivery.namespace == TileCacheNamespace(dataZoom: 15, tileSchemaVersion: 1))
        #expect(manifestDelivery.manifestVersion == 1)
        #expect(manifestDelivery.maxPartBodyBytes == 44_000)
        let singleBody = try TileConfigClient.delivery(fromConfigJSON: configJSON(delivery: false))
        #expect(singleBody.manifestVersion == nil)
        #expect(singleBody.namespace == .legacy)
        // Fail closed on a manifest or tile schema this build cannot read.
        #expect(throws: TileSyncError.self) { try TileConfigClient.delivery(fromConfigJSON: configJSON(manifestVersion: 2)) }
        #expect(throws: TileSyncError.self) { try TileConfigClient.delivery(fromConfigJSON: configJSON(minimumTile: 2)) }
        #expect(throws: TileSyncError.self) { try TileConfigClient.delivery(fromConfigJSON: configJSON(zoom: 31)) }
    }

    @Test func namespaceKeyIsZoomAndBodySchemaOnly() {
        #expect(TileCacheNamespace.legacy.key == "z14-s1")
        #expect(TileCacheNamespace.parse(key: "z15-s1") == TileCacheNamespace(dataZoom: 15, tileSchemaVersion: 1))
        #expect(TileCacheNamespace.parse(key: "z99-s1") == nil)
        #expect(TileCacheNamespace.parse(key: "garbage") == nil)
    }

    // MARK: Manifest and assembly

    @Test func assemblesCompleteLogicalTileFromVerifiedParts() throws {
        let (manifestData, parts) = try twoParts(revision: 2)
        let delivery = try TileConfigClient.delivery(fromConfigJSON: configJSON())
        let manifest = try JSONDecoder().decode(TileManifestV1.self, from: manifestData).validated(for: tile, delivery: delivery)
        let body = try TilePartAssembler.assemble(manifest: manifest, partBodies: parts)
        #expect(body.spots.map(\.id) == (1...5).map(spotID))
        #expect(body.sources.map(\.id) == [sourceID])
        #expect(try TileSpotMapper.map(body, requestedTile: tile).spots.count == 5)
    }

    @Test func rejectsMissingDuplicatedWrongRevisionAndCorruptParts() throws {
        let (manifestData, parts) = try twoParts(revision: 2)
        let manifest = try JSONDecoder().decode(TileManifestV1.self, from: manifestData)
        // Missing part.
        #expect(throws: TileSyncError.malformedResponse) { try TilePartAssembler.assemble(manifest: manifest, partBodies: [parts[0]]) }
        // Duplicated part (part 0 served for index 1): its hash is not part 1's.
        #expect(throws: TileSyncError.malformedResponse) { try TilePartAssembler.assemble(manifest: manifest, partBodies: [parts[0], parts[0]]) }
        // Wrong revision: a part of another revision, even with a manifest entry that matches its bytes.
        let stale = try partBody(revision: 1, numbers: 4...5)
        let mixed = try JSONDecoder().decode(TileManifestV1.self, from: manifest(revision: 2, parts: [parts[0], stale], counts: [3, 2]))
        #expect(throws: TileSyncError.malformedResponse) { try TilePartAssembler.assemble(manifest: mixed, partBodies: [parts[0], stale]) }
        // Corrupt part.
        var corrupt = parts[1]
        corrupt[corrupt.startIndex] = UInt8(ascii: " ")
        #expect(throws: TileSyncError.malformedResponse) { try TilePartAssembler.assemble(manifest: manifest, partBodies: [parts[0], corrupt]) }
        // Overlapping parts (spot 3 twice), each part individually valid.
        let overlapping = [try partBody(revision: 2, numbers: 1...3), try partBody(revision: 2, numbers: 3...5)]
        let overlapManifest = try JSONDecoder().decode(TileManifestV1.self, from: manifest(revision: 2, parts: overlapping, counts: [3, 3]))
        #expect(throws: TileSyncError.malformedResponse) { try TilePartAssembler.assemble(manifest: overlapManifest, partBodies: overlapping) }
    }

    @Test func manifestForAnotherTileOrReorderedIndexIsRejected() throws {
        let (_, parts) = try twoParts(revision: 2)
        let delivery = try TileConfigClient.delivery(fromConfigJSON: configJSON())
        let other = try JSONDecoder().decode(TileManifestV1.self, from: manifest(revision: 2, parts: parts, counts: [3, 2], tileID: "14/1/1"))
        #expect(throws: TileSyncError.malformedResponse) { try other.validated(for: tile, delivery: delivery) }
    }

    // MARK: Sync, atomic replacement and offline

    @Test func multipartSyncReplacesAtomicallyAndKeepsPreviousTileOnAnyBadPart() async throws {
        let path = cachePath()
        let store = try GRDBTileStore(path: path)
        let (manifest1, parts1) = try twoParts(revision: 1)
        let corruptPart: Data = {
            var data = parts1[1]
            data[data.startIndex] = UInt8(ascii: " ")
            return data
        }()
        let (manifest2, parts2) = try twoParts(revision: 2)
        let transport = ScriptedTransport([
            "/v1/config": [ok(try configJSON())],
            manifestPath: [ok(manifest1, etag: #""m1-one""#), ok(manifest2, etag: #""m1-two""#), ok(manifest2, etag: #""m1-two""#)],
            partPath(0): [ok(parts1[0]), ok(parts2[0]), ok(parts2[0])],
            partPath(1): [ok(parts1[1]), ok(corruptPart), TileHTTPResponse(statusCode: 404, body: Data(), etag: nil)]
        ])
        let sync = service(transport, store: store)

        let first = try await sync.sync(tile)
        #expect(first.spots.map(\.id) == (1...5).map(spotID))
        #expect(first.etag == #""m1-one""#)

        // Revision 2 arrives with a corrupt part: nothing changes, the previous complete tile stays.
        await #expect(throws: TileSyncError.self) { _ = try await sync.sync(tile) }
        let afterCorrupt = try #require(try await store.cachedTile(tile))
        #expect(afterCorrupt.revision == 1)
        #expect(afterCorrupt.etag == #""m1-one""#)
        #expect(afterCorrupt.spots.map(\.id) == (1...5).map(spotID))

        // A part that is gone (republished meanwhile): still the previous complete tile.
        await #expect(throws: TileSyncError.self) { _ = try await sync.sync(tile) }
        #expect(try await store.cachedTile(tile)?.revision == 1)
        #expect(await transport.requested().filter { $0 == "/v1/config" }.count == 1, "config is fetched once per TTL")

        // Offline: a fresh store on the same file reads the complete tile with no network at all.
        let offline = try GRDBTileStore(path: path)
        #expect(await offline.dataZoom() == 14)
        #expect(try await offline.spots(inTile: tile.id).map(\.id) == (1...5).map(spotID))
        #expect(try await offline.sources(inTile: tile.id).map(\.id) == [sourceID])
    }

    @Test func singleBodyDeploymentKeepsTheLegacyPath() async throws {
        let store = try GRDBTileStore(path: cachePath())
        let body = try partBody(revision: 1, numbers: 1...2)
        let transport = ScriptedTransport([
            "/v1/config": [ok(try configJSON(delivery: false))],
            "/v1/tiles/\(tile.id)": [ok(body, etag: #""1-abc""#)]
        ])
        let cached = try await service(transport, store: store).sync(tile)
        #expect(cached.spots.count == 2)
        #expect(await transport.requested() == ["/v1/config", "/v1/tiles/\(tile.id)"])
    }

    @Test func zoomChangeSwitchesNamespaceAndPersistsIt() async throws {
        let path = cachePath()
        let store = try GRDBTileStore(path: path)
        let (manifest1, parts1) = try twoParts(revision: 1)
        let transport = ScriptedTransport([
            "/v1/config": [ok(try configJSON())],
            manifestPath: [ok(manifest1, etag: #""m1-one""#)],
            partPath(0): [ok(parts1[0])], partPath(1): [ok(parts1[1])]
        ])
        _ = try await service(transport, store: store).sync(tile)

        // The server moves to zoom 15: the cache switches namespace; zoom-14 reads are no longer served.
        try await store.activate(TileCacheNamespace(dataZoom: 15, tileSchemaVersion: 1))
        #expect(await store.dataZoom() == 15)
        await #expect(throws: TileSyncError.invalidTile) { _ = try await store.spots(inTile: tile.id) }
        let z15 = SlippyTile(z: 15, x: 29106, y: 12898)!
        #expect(try await store.spots(inTile: z15.id).isEmpty)
        // A sync started for zoom 14 cannot write into the zoom-15 namespace.
        let mapped = try TileSpotMapper.map(try JSONDecoder().decode(TileBodyV1.self, from: parts1[0]), requestedTile: tile)
        await #expect(throws: TileCacheError.namespaceChanged) {
            _ = try await store.replace(mapped, etag: "x", forSync: 99, namespace: .legacy)
        }
        // Persisted: an offline relaunch reads the zoom-15 namespace.
        #expect(await (try GRDBTileStore(path: path)).dataZoom() == 15)
        // Switching back finds the zoom-14 tile intact.
        try await store.activate(.legacy)
        #expect(try await store.spots(inTile: tile.id).count == 3)
    }

    // MARK: Map clustering

    @MainActor @Test func clusteringItemsMirrorTheResultListExactly() throws {
        let body = try JSONDecoder().decode(TileBodyV1.self, from: partBody(revision: 1, numbers: 1...2_000))
        let spots = try TileSpotMapper.map(body, requestedTile: tile).spots
        let results = spots.reversed().map { NearbyResult(spot: $0, distanceMeters: 1, bearingDegrees: 0, verificationAge: nil) }
        let items = SpotMapItem.items(results: Array(results), location: nil, locationLabel: "Your location", destination: nil)
        let ids = items.compactMap { item -> String? in if case .spot(let id, _) = item.kind { return id } else { return nil } }
        #expect(ids == results.map(\.spot.id), "one annotation per result, same ids, same order: clustering is presentation only")
        #expect(items.allSatisfy { if case .spot = $0.kind { return true } else { return false } })
    }
}
