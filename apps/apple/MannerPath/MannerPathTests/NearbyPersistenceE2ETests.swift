import CryptoKit
import Foundation
import GRDB
import Testing
@testable import MannerPath

/// Synthetic responses only: exercises the production network/parser/store/model/publisher boundaries,
/// without claiming a signed App Group, GPS, MapKit rendering or a production corpus was tested.
@MainActor
struct NearbyPersistenceE2ETests {
    private let origin = SpotCoordinate(latitude: 35.7112, longitude: 139.77377)
    private let base = URL(string: "https://tiles.example.invalid")!
    private let sourceID = "test-reviewed-source"

    @Test func multipartOnlineCorpusSurvivesDatabaseReopenOfflineAndWidgetFileRoundTrip() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let path = directory.appendingPathComponent("tiles.sqlite").path
        let tile = try homeTile()
        let rows = (1...32).map(spot)
        let parts = try [Array(rows.prefix(16)), Array(rows.suffix(16))].enumerated().map { index, spots in
            try json(["schemaVersion": 2, "tile": tile.id, "part": index, "partCount": 2,
                      "spots": spots, "sources": [source]])
        }
        let manifest = try json([
            "schemaVersion": 2, "tile": tile.id, "revision": 7, "generatedAt": "2026-10-01T00:00:00Z",
            "partPolicy": "tile-parts.v1", "spotCount": 32,
            "parts": parts.enumerated().map { ["index": $0.offset, "spotCount": 16, "sha256": sha($0.element)] },
        ])
        let etag = "\"2-\(sha(manifest))\""
        let transport = PersistenceTransport([
            "/v1/config": [response(try config())],
            "/v1/tiles/\(tile.id)": [problem(409, "tileRequiresParts")],
            "/v1/tiles/\(tile.id)/manifest": [response(manifest, etag: etag), TileHTTPResponse(statusCode: 304, body: Data(), etag: etag)],
            "/v1/tiles/\(tile.id)/parts/0": [response(parts[0])],
            "/v1/tiles/\(tile.id)/parts/1": [response(parts[1])],
        ], fallback: problem(404, "tileNotPublished"))
        let store = try GRDBTileStore(path: path)
        let sync = service(store: store, transport: transport)
        let online = NearbyModel(location: location(), repository: store, refresher: sync)
        #expect(await settled(online, at: .refreshed))
        #expect(online.results.count == 32)
        #expect(Set(online.results.map(\.spot.id)).count == 32)
        #expect(online.sources.map(\.id) == [sourceID])
        #expect(online.result(id: id(1))?.spot.name == "Synthetic place 1")
        let revalidated = try await sync.sync(tile)
        #expect(revalidated.etag == etag && revalidated.revision == 7)
        #expect(await transport.lastConditionalHeader() == etag)

        // Reopen instead of reusing the first store/model: cache recovery must survive process replacement.
        let reopened = try GRDBTileStore(path: path)
        let offlineTransport = PersistenceTransport([:], offline: true)
        let offline = NearbyModel(location: location(), repository: reopened,
                                  refresher: service(store: reopened, transport: offlineTransport))
        #expect(await settled(offline, at: .refreshFailed))
        #expect(offline.results.map(\.spot.id) == online.results.map(\.spot.id))
        #expect(offline.sources == online.sources)
        #expect(offline.results.first?.distanceMeters == online.results.first?.distanceMeters)
        #expect(offline.results.first?.bearingDegrees == online.results.first?.bearingDegrees)
        var published = false
        offline.onCachedGlanceChange = { spots, location in
            let glance = PhoneGlancePublisher.build(spots: spots, near: location, at: location.timestamp)
            do { try NearbyGlanceFile.write(glance, to: directory); published = true }
            catch { Issue.record("Glance file write failed: \(error)") }
        }
        offline.publishCachedCorpusForWatch()
        #expect(published)
        let glance = try #require(NearbyGlanceFile.read(from: directory))
        #expect(glance.spotID == offline.results.first?.spot.id)
        #expect(glance.name == offline.results.first?.spot.name)
        #expect(glance.distanceMeters == offline.results.first?.distanceMeters)
        #expect(glance.lastVerifiedAt == offline.results.first?.spot.lastVerifiedAt)
        #expect(NearbyGlance.spotID(from: glance.deepLink) == .some(glance.spotID))
        #expect(await offlineTransport.requestPaths() == ["/v1/config"], "offline config failure preserves cached namespace; no tile request")
    }

    @Test func authoritativeUnpublishedNeighborhoodClearsDiskAndPublishesEmptyGlance() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let path = directory.appendingPathComponent("tiles.sqlite").path
        let tile = try homeTile()
        let store = try GRDBTileStore(path: path)
        try await seed(store, tile: tile)
        let transport = PersistenceTransport(["/v1/config": [response(try config())]], fallback: problem(404, "tileNotPublished"))
        let model = NearbyModel(location: location(), repository: store, refresher: service(store: store, transport: transport))
        #expect(await settled(model, at: .refreshed))
        #expect(model.results.isEmpty && model.sources.isEmpty)
        let reopened = try GRDBTileStore(path: path)
        #expect(try await reopened.spots(inTile: tile.id).isEmpty)
        let device = location().state
        guard case .usable(let observed) = device else { Issue.record("Expected fixture location"); return }
        let empty = PhoneGlancePublisher.build(spots: [], near: observed, at: observed.timestamp)
        try NearbyGlanceFile.write(empty, to: directory)
        #expect(NearbyGlanceFile.read(from: directory)?.state(at: observed.timestamp) == .empty)
    }

    @Test func serverFailurePreservesSavedResultsAndCorruptCacheDoesNotReplaceWidgetWithFalseEmpty() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let path = directory.appendingPathComponent("tiles.sqlite").path
        let tile = try homeTile()
        let store = try GRDBTileStore(path: path)
        try await seed(store, tile: tile)
        let transport = PersistenceTransport(["/v1/config": [response(try config())]], fallback: response(Data(), status: 503))
        let failed = NearbyModel(location: location(), repository: store, refresher: service(store: store, transport: transport))
        #expect(await settled(failed, at: .refreshFailed))
        #expect(failed.results.map(\.spot.id) == [id(1)])
        failed.onCachedGlanceChange = { spots, observed in
            try? NearbyGlanceFile.write(PhoneGlancePublisher.build(spots: spots, near: observed, at: observed.timestamp), to: directory)
        }
        failed.publishCachedCorpusForWatch()
        let savedGlance = try #require(NearbyGlanceFile.read(from: directory))

        // Inject malformed persisted spot bytes, not a fake repository error.
        let database = try DatabaseQueue(path: path)
        try await database.write { db in
            try db.execute(sql: "UPDATE cached_tile_spots SET spot_json = ? WHERE tile_id = ?", arguments: [Data("{broken".utf8), tile.id])
        }
        let reopened = try GRDBTileStore(path: path)
        let corrupt = NearbyModel(location: location(), repository: reopened, refresher: nil)
        var widgetWrites = 0
        corrupt.onCachedGlanceChange = { _, _ in widgetWrites += 1 }
        #expect(await settled(corrupt, at: .refreshFailed))
        #expect(corrupt.results.isEmpty)
        corrupt.publishCachedCorpusForWatch()
        #expect(widgetWrites == 0, "cache read failure is not authoritative absence")
        #expect(NearbyGlanceFile.read(from: directory) == savedGlance)
    }

    private func service(store: GRDBTileStore, transport: PersistenceTransport) -> TileSyncService {
        TileSyncService(client: TileAPIClient(baseURL: base, transport: transport), store: store,
                        config: TileConfigClient(baseURL: base, transport: transport))
    }
    private func homeTile() throws -> SlippyTile {
        try SlippyTile.forCoordinate(latitude: origin.latitude, longitude: origin.longitude, zoom: 14)
    }
    private func location() -> PersistenceLocation {
        PersistenceLocation(state: .usable(DeviceLocation(coordinate: origin, timestamp: Date(timeIntervalSince1970: 1_800_000_000),
            horizontalAccuracyMeters: 10, isApproximate: false, isLastKnown: false)))
    }
    private func settled(_ model: NearbyModel, at expected: NearbyDataState) async -> Bool {
        for _ in 0..<400 {
            if model.dataState == expected { return true }
            try? await Task.sleep(for: .milliseconds(10))
        }
        return false
    }
    private func temporaryDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("nearby-persistence-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }
    private func seed(_ store: GRDBTileStore, tile: SlippyTile) async throws {
        let body = try json(["schemaVersion": 1, "tile": tile.id, "revision": 1, "generatedAt": "2026-10-01T00:00:00Z",
                             "spots": [spot(1)], "sources": [source]])
        let mapped = try TileSpotMapper.map(JSONDecoder().decode(TileBodyV1.self, from: body), requestedTile: tile)
        try await store.replace(mapped, etag: "\"1-saved\"")
    }
    private var source: [String: Any] {
        ["id": sourceID, "displayName": "Synthetic reviewed source", "licenseName": "CC BY 4.0",
         "licenseUrl": "https://example.invalid/license", "attributionText": "Synthetic source attribution"]
    }
    private func id(_ number: Int) -> String {
        "sp_" + String(repeating: "0", count: 26 - String(number).count) + String(number)
    }
    private func spot(_ number: Int) -> [String: Any] {
        ["id": id(number), "name": "Synthetic place \(number)", "latitude": origin.latitude,
         "longitude": origin.longitude + Double(number) * 0.00001,
         "spotType": "ashtray", "accessType": "public", "environment": "outdoor",
         "supportsPaper": "unknown", "supportsHeated": "unknown",
         "openingHours": ["status": "none", "raw": NSNull(), "parsed": NSNull(), "timeZone": "Asia/Tokyo"],
         "lifecycle": "active", "evidenceQuality": "officialListing", "evidenceQualityVersion": "evidence-quality.v1",
         "lastVerifiedAt": "2026-08-18", "sourceIds": [sourceID]]
    }
    private func config() throws -> Data {
        try json(["schemaVersion": 1, "apiVersion": "v1", "dataTileZoom": 14,
                  "schemaVersions": ["tile": 2, "spotDetail": 1, "report": 3],
                  "minimumSupportedSchemaVersions": ["tile": 1, "spotDetail": 1, "report": 1]])
    }
    private func json(_ value: [String: Any]) throws -> Data { try JSONSerialization.data(withJSONObject: value) }
    private func sha(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    private func response(_ data: Data, status: Int = 200, etag: String? = nil) -> TileHTTPResponse {
        TileHTTPResponse(statusCode: status, body: data, etag: etag)
    }
    private func problem(_ status: Int, _ error: String) -> TileHTTPResponse {
        response(Data("{\"error\":\"\(error)\",\"detail\":\"Synthetic response\"}".utf8), status: status)
    }
}

private actor PersistenceTransport: TileHTTPTransport {
    private var responses: [String: [TileHTTPResponse]]
    private let fallback: TileHTTPResponse?
    private let offline: Bool
    private var requests: [URLRequest] = []
    init(_ responses: [String: [TileHTTPResponse]], fallback: TileHTTPResponse? = nil, offline: Bool = false) {
        self.responses = responses; self.fallback = fallback; self.offline = offline
    }
    func send(_ request: URLRequest) async throws -> TileHTTPResponse {
        requests.append(request)
        if offline { throw URLError(.notConnectedToInternet) }
        let path = request.url!.path
        if var queue = responses[path], !queue.isEmpty {
            let next = queue.removeFirst(); responses[path] = queue; return next
        }
        if let fallback { return fallback }
        throw URLError(.fileDoesNotExist)
    }
    func lastConditionalHeader() -> String? { requests.last?.value(forHTTPHeaderField: "If-None-Match") }
    func requestPaths() -> [String] { requests.map { $0.url!.path } }
}

@MainActor
private final class PersistenceLocation: LocationProviding {
    let state: NearbyLocationState
    var onStateChange: (@MainActor (NearbyLocationState) -> Void)?
    init(state: NearbyLocationState) { self.state = state }
    func refresh() {}
}
