import CryptoKit
import Foundation
import MapKit
import Testing
@testable import MannerPath

// ADR-0015: config-driven zoom, the cache namespace, multi-part tiles and the clustered map's pure logic.

private actor ScriptedTransport: TileHTTPTransport {
    private var responses: [String: [TileHTTPResponse]]
    private(set) var requests: [URLRequest] = []

    init(_ responses: [String: [TileHTTPResponse]]) { self.responses = responses }

    func send(_ request: URLRequest) async throws -> TileHTTPResponse {
        requests.append(request)
        let path = request.url!.path
        guard var queue = responses[path], !queue.isEmpty else { throw URLError(.fileDoesNotExist) }
        let next = queue.removeFirst()
        responses[path] = queue
        return next
    }

    func paths() -> [String] { requests.map { $0.url!.path } }
    func header(_ index: Int) -> String? { requests[index].value(forHTTPHeaderField: "If-None-Match") }
}

/// Holds the first manifest response until released, so a namespace change can happen mid-sync.
private actor HeldTransport: TileHTTPTransport {
    private let response: TileHTTPResponse
    private var waiter: CheckedContinuation<Void, Never>?
    private var held: CheckedContinuation<TileHTTPResponse, Never>?

    init(_ response: TileHTTPResponse) { self.response = response }

    func send(_ request: URLRequest) async throws -> TileHTTPResponse {
        waiter?.resume()
        waiter = nil
        return await withCheckedContinuation { held = $0 }
    }

    func waitForRequest() async {
        if held != nil { return }
        await withCheckedContinuation { waiter = $0 }
    }

    func release() {
        held?.resume(returning: response)
        held = nil
    }
}

struct TileDeliveryV2Tests {
    private let base = URL(string: "https://tiles.example.invalid")!
    private let tile = SlippyTile(z: 14, x: 14553, y: 6449)!
    private let sourceID = "approved-municipal-source"

    // MARK: config

    @Test func configZoomIsReadAndUnsupportedConfigFailsClosed() async throws {
        let cases: [(Data, Int, Result<Int, TileSyncError>)] = [
            (config(zoom: 14), 200, .success(14)),
            (config(zoom: 16), 200, .success(16)),
            (config(zoom: 17), 200, .failure(.unsupportedConfig)),
            (config(zoom: 13), 200, .failure(.unsupportedConfig)),
            (config(zoom: 14, tile: 4, minimumTile: 3), 200, .failure(.unsupportedConfig)),
            (config(zoom: 14, tile: 3, minimumTile: 2), 200, .success(14)),
            (Data(#"{"schemaVersion":2}"#.utf8), 200, .failure(.malformedResponse)),
            (Data(), 503, .failure(.httpStatus(503))),
        ]
        for (body, status, expected) in cases {
            let transport = ScriptedTransport(["/v1/config": [TileHTTPResponse(statusCode: status, body: body, etag: nil)]])
            let client = TileConfigClient(baseURL: base, transport: transport)
            switch expected {
            case .success(let zoom):
                #expect(try await client.dataTileZoom() == zoom)
            case .failure(let error):
                await #expect(throws: error) { try await client.dataTileZoom() }
            }
        }
    }

    // MARK: cache namespace

    @Test func zoomChangeEvictsTheOldNamespaceAtomicallyAndPersists() async throws {
        let path = cachePath()
        let store = try GRDBTileStore(path: path)
        #expect(try await store.dataZoom() == 14, "a new or pre-namespace cache is the z14 world")
        try await store.replace(mapped(tile, spots: [spot(1, in: tile)]), etag: #""1-a""#)
        #expect(try await store.activate(dataZoom: 14) == false)
        #expect(try await store.cachedTile(tile)?.spots.count == 1, "the same zoom keeps the cache")

        #expect(try await store.activate(dataZoom: 15) == true)
        await #expect(throws: TileSyncError.invalidTile) { try await store.cachedTile(tile) }
        let z15 = try SlippyTile.forCoordinate(latitude: 35.7112, longitude: 139.77377, zoom: 15)
        #expect(try await store.cachedTile(z15) == nil, "nothing of the old namespace survives")
        await #expect(throws: TileSyncError.invalidTile) {
            try await store.replace(mapped(tile, spots: [spot(1, in: tile)]), etag: #""1-a""#)
        }

        let reopened = try GRDBTileStore(path: path)
        #expect(try await reopened.dataZoom() == 15)
        await #expect(throws: TileSyncError.unsupportedConfig) { try await reopened.activate(dataZoom: 20) }
        #expect(try await reopened.dataZoom() == 15)
    }

    @Test func aSyncBegunBeforeAZoomChangeNeverWritesIntoTheNewNamespace() async throws {
        let store = try GRDBTileStore(path: cachePath())
        let transport = HeldTransport(TileHTTPResponse(statusCode: 200, body: try v1Body(spots: [spot(1, in: tile)]), etag: #""1-a""#))
        let service = TileSyncService(client: TileAPIClient(baseURL: base, transport: transport), store: store)
        let pending = Task { try await service.sync(tile) }
        await transport.waitForRequest()
        try await store.activate(dataZoom: 15)
        await transport.release()
        _ = try? await pending.value
        let z15 = try SlippyTile.forCoordinate(latitude: 35.7112, longitude: 139.77377, zoom: 15)
        #expect(try await store.cachedTile(z15) == nil)
        #expect(try await store.dataZoom() == 15)
    }

    @Test func prepareReadsConfigAndMovesTheCache() async throws {
        let store = try GRDBTileStore(path: cachePath())
        try await store.replace(mapped(tile, spots: [spot(1, in: tile)]), etag: #""1-a""#)
        let transport = ScriptedTransport(["/v1/config": [
            TileHTTPResponse(statusCode: 200, body: config(zoom: 14), etag: nil),
            TileHTTPResponse(statusCode: 200, body: config(zoom: 99), etag: nil),
            TileHTTPResponse(statusCode: 200, body: config(zoom: 16), etag: nil),
        ]])
        let service = TileSyncService(client: TileAPIClient(baseURL: base, transport: transport), store: store,
                                      config: TileConfigClient(baseURL: base, transport: transport))
        #expect(try await service.prepare() == 14)
        #expect(try await store.cachedTile(tile)?.spots.count == 1)
        await #expect(throws: TileSyncError.unsupportedConfig) { try await service.prepare() }
        #expect(try await store.cachedTile(tile)?.spots.count == 1, "unsupported config leaves the cache readable")
        #expect(try await service.prepare() == 16)
        #expect(try await store.dataZoom() == 16)
    }

    // MARK: parts

    @Test func multiPartTileIsAssembledVerifiedAndThenRevalidatedAtItsManifest() async throws {
        let spots = (1...600).map { spot($0, in: tile) }
        let parts = try [Array(spots[0..<250]), Array(spots[250..<500]), Array(spots[500...])].enumerated().map {
            try partBody(index: $0.offset, count: 3, spots: $0.element)
        }
        let manifest = try manifestBody(revision: 4, parts: parts)
        let manifestETag = #""2-\#(sha(manifest))""#
        let transport = ScriptedTransport([
            "/v1/tiles/\(tile.id)": [problem(409, "tileRequiresParts")],
            "/v1/tiles/\(tile.id)/manifest": [TileHTTPResponse(statusCode: 200, body: manifest, etag: manifestETag),
                                              TileHTTPResponse(statusCode: 304, body: Data(), etag: manifestETag)],
            "/v1/tiles/\(tile.id)/parts/0": [TileHTTPResponse(statusCode: 200, body: parts[0], etag: nil)],
            "/v1/tiles/\(tile.id)/parts/1": [TileHTTPResponse(statusCode: 200, body: parts[1], etag: nil)],
            "/v1/tiles/\(tile.id)/parts/2": [TileHTTPResponse(statusCode: 200, body: parts[2], etag: nil)],
        ])
        let store = try GRDBTileStore(path: cachePath())
        let service = TileSyncService(client: TileAPIClient(baseURL: base, transport: transport), store: store)

        let synced = try await service.sync(tile)
        #expect(synced.spots.count == 600)
        #expect(synced.revision == 4)
        #expect(synced.etag == manifestETag)
        #expect(synced.sources.map(\.id) == [sourceID])
        let again = try await service.sync(tile)
        #expect(again.spots.count == 600)
        let paths = await transport.paths()
        #expect(Array(paths.prefix(2)) == ["/v1/tiles/\(tile.id)", "/v1/tiles/\(tile.id)/manifest"])
        #expect(Set(paths[2..<5]) == Set((0..<3).map { "/v1/tiles/\(tile.id)/parts/\($0)" }), "parts are fetched concurrently")
        #expect(paths.last == "/v1/tiles/\(tile.id)/manifest")
        #expect(paths.count == 6)
        #expect(await transport.header(5) == manifestETag, "a parts tile is revalidated at its manifest, not the v1 path")
    }

    @Test func aPartThatDoesNotMatchItsManifestNeverReplacesTheCache() async throws {
        let first = try partBody(index: 0, count: 2, spots: [spot(1, in: tile)])
        let second = try partBody(index: 1, count: 2, spots: [spot(2, in: tile)])
        let manifest = try manifestBody(revision: 2, parts: [first, second])
        let republished = try partBody(index: 1, count: 2, spots: [spot(3, in: tile)])
        for (secondResponse, expected) in [
            (TileHTTPResponse(statusCode: 200, body: republished, etag: nil), TileSyncError.partsChanged),
            (problem(404, "tilePartNotPublished"), TileSyncError.partsChanged),
            (TileHTTPResponse(statusCode: 500, body: Data(), etag: nil), TileSyncError.httpStatus(500)),
        ] {
            let store = try GRDBTileStore(path: cachePath())
            try await store.replace(mapped(tile, spots: [spot(9, in: tile)]), etag: #""1-old""#)
            let transport = ScriptedTransport([
                "/v1/tiles/\(tile.id)": [problem(409, "tileRequiresParts")],
                "/v1/tiles/\(tile.id)/manifest": [TileHTTPResponse(statusCode: 200, body: manifest, etag: #""2-m""#)],
                "/v1/tiles/\(tile.id)/parts/0": [TileHTTPResponse(statusCode: 200, body: first, etag: nil)],
                "/v1/tiles/\(tile.id)/parts/1": [secondResponse],
            ])
            let service = TileSyncService(client: TileAPIClient(baseURL: base, transport: transport), store: store)
            await #expect(throws: expected) { try await service.sync(tile) }
            let cached = try #require(await store.cachedTile(tile))
            #expect(cached.spots.map(\.id) == [spotID(9)], "no mixed snapshot")
            #expect(cached.etag == #""1-old""#)
        }
    }

    @Test func malformedManifestsAreRejected() async throws {
        let part = try partBody(index: 0, count: 1, spots: [spot(1, in: tile)])
        let good = try JSONSerialization.jsonObject(with: manifestBody(revision: 1, parts: [part])) as! [String: Any]
        var outOfOrder = good
        outOfOrder["parts"] = [["index": 1, "spotCount": 1, "sha256": sha(part)]]
        var wrongTotal = good
        wrongTotal["spotCount"] = 2
        var tooMany = good
        tooMany["parts"] = (0...128).map { ["index": $0, "spotCount": 1, "sha256": sha(part)] }
        tooMany["spotCount"] = 129
        var otherTile = good
        otherTile["tile"] = "14/1/1"
        for manifest in [outOfOrder, wrongTotal, tooMany, otherTile] {
            let transport = ScriptedTransport([
                "/v1/tiles/\(tile.id)": [problem(409, "tileRequiresParts")],
                "/v1/tiles/\(tile.id)/manifest": [TileHTTPResponse(statusCode: 200, body: try JSONSerialization.data(withJSONObject: manifest), etag: #""2-m""#)],
            ])
            await #expect(throws: TileSyncError.malformedResponse) {
                _ = try await TileAPIClient(baseURL: base, transport: transport).fetch(tile, ifNoneMatch: nil)
            }
        }
    }

    @Test func singlePartTilesStayOnTheV1PathAndAnUnknown409FailsClosed() async throws {
        let transport = ScriptedTransport(["/v1/tiles/\(tile.id)": [
            TileHTTPResponse(statusCode: 200, body: try v1Body(spots: [spot(1, in: tile)]), etag: #""1-a""#),
            problem(409, "somethingElse"),
        ]])
        let client = TileAPIClient(baseURL: base, transport: transport)
        guard case .snapshot(let mapped, let etag) = try await client.fetch(tile, ifNoneMatch: nil) else {
            Issue.record("expected a snapshot"); return
        }
        #expect(mapped.spots.count == 1)
        #expect(etag == #""1-a""#)
        await #expect(throws: TileSyncError.httpStatus(409)) { _ = try await client.fetch(tile, ifNoneMatch: etag) }
        #expect(await transport.paths().allSatisfy { $0 == "/v1/tiles/\(tile.id)" })
    }

    // MARK: dense map and Watch

    @Test func annotationDiffTouchesOnlyChangedPins() {
        let a = pin("a"), b = pin("b"), c = pin("c")
        let movedB = SpotMapPin(id: "b", title: "b", coordinate: SpotCoordinate(latitude: 35.1, longitude: 139),
                                existence: .official, accessibilityValue: "")
        let diff = SpotMapAnnotationDiff.diff(current: ["a": a, "b": b, "c": c], next: [a, movedB, pin("d")])
        #expect(diff.remove == ["b", "c"])
        #expect(diff.add.map(\.id) == ["b", "d"])
        let dense = (0..<2_000).map { pin("s\($0)") }
        let noChange = SpotMapAnnotationDiff.diff(current: Dictionary(uniqueKeysWithValues: dense.map { ($0.id, $0) }), next: dense)
        #expect(noChange.remove.isEmpty && noChange.add.isEmpty, "a refresh with equal results re-adds nothing")
    }

    @Test func clusterShowsItsStrongestEvidenceAndExpandsToItsMembers() throws {
        #expect(SpotMapCluster.existence(of: [.communityReported, .official, .unknown]) == .official)
        #expect(SpotMapCluster.existence(of: [.communityReported, .communityVerified]) == .communityVerified)
        #expect(SpotMapCluster.existence(of: []) == .unknown)
        let members = [SpotCoordinate(latitude: 35.6900, longitude: 139.7000),
                       SpotCoordinate(latitude: 35.6910, longitude: 139.7020)]
        let region = try #require(SpotMapCluster.expansionRegion(for: members))
        #expect(abs(region.center.latitude - 35.6905) < 1e-9)
        #expect(region.span.latitudeDelta >= 0.001 && region.span.longitudeDelta >= 0.002)
        let stacked = try #require(SpotMapCluster.expansionRegion(for: [members[0], members[0]]))
        #expect(stacked.span.latitudeDelta == 0.0008, "co-located members still get a usable zoom")
        #expect(SpotMapCluster.expansionRegion(for: []) == nil)
    }

    // docs/DESIGN.md §9: evidence never sets a pin's colour; it is told apart by glyph, and only selection is yellow.
    @Test func pinsAreNeutralUntilSelectedAndEvidenceUsesGlyphs() {
        #expect(SpotMapCluster.tint(selected: false) == .systemGray)
        #expect(SpotMapCluster.tint(selected: true) != .systemGray)
        #expect(SpotMapCluster.tint(selected: true) != .systemRed)
        let all: [ExistenceEvidence] = [.official, .operator, .communityVerified, .communityReported, .unknown]
        #expect(Set(all.map(SpotMapCluster.glyph)).count == all.count)
    }

    // #217 review: a tap on the current-location marker reaches what it covers, chosen by role and screen position only.
    // The candidates carry no visibility, so a collision-hidden cluster or pin is a target like any other.
    @Test func locationMarkerForwardsOnlyToWhatItCovers() {
        typealias C = LocationMarkerForwarding.Candidate<String>
        let bounds = CGRect(x: 0, y: 0, width: 400, height: 800)
        let marker = CGPoint(x: 200, y: 400)
        func target(_ candidates: [C], marker: CGPoint = marker) -> String? {
            LocationMarkerForwarding.target(marker: marker, bounds: bounds, candidates: candidates)?.id
        }
        let hiddenCluster = C(id: "cluster", role: .cluster, point: CGPoint(x: 204, y: 402), isClusterMember: false)
        let hiddenSpot = C(id: "spot", role: .spot, point: CGPoint(x: 198, y: 397), isClusterMember: false)
        let member = C(id: "member", role: .spot, point: CGPoint(x: 200, y: 400), isClusterMember: true)
        let farSpot = C(id: "far", role: .spot, point: CGPoint(x: 260, y: 400), isClusterMember: false)
        let destination = C(id: "destination", role: .other, point: CGPoint(x: 200, y: 400), isClusterMember: false)
        let provisional = C(id: "provisional", role: .other, point: CGPoint(x: 201, y: 401), isClusterMember: false)

        // A: a cluster under the marker wins, even over a nearer single pin.
        #expect(target([hiddenSpot, hiddenCluster, member]) == "cluster")
        // B: a single pin under the marker; a cluster's own member is never chosen on its own.
        #expect(target([hiddenSpot, member, farSpot]) == "spot")
        #expect(target([member]) == nil)
        // C: nothing under the marker selects nothing.
        #expect(target([]) == nil)
        // D: an unrelated pin nearby but not under the marker is not chosen.
        #expect(target([farSpot]) == nil)
        #expect(target([farSpot, hiddenSpot]) == "spot")
        // E, F: the destination, a provisional pin or any other annotation is never a target.
        #expect(target([destination, provisional]) == nil)
        // Off screen: neither a candidate off screen nor a marker off screen forwards.
        let offscreen = C(id: "off", role: .cluster, point: CGPoint(x: -5, y: 400), isClusterMember: false)
        #expect(target([offscreen], marker: CGPoint(x: 10, y: 400)) == nil)
        #expect(target([hiddenSpot], marker: CGPoint(x: 200, y: 900)) == nil)
        // The overlap edge is inclusive and nearest wins among several.
        let edge = C(id: "edge", role: .spot, point: CGPoint(x: 230, y: 400), isClusterMember: false)
        #expect(target([edge]) == "edge")
        #expect(target([edge, hiddenSpot]) == "spot")
    }

    @Test func mapRectCoversTheRegion() {
        let region = MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 35.71, longitude: 139.77),
                                        span: MKCoordinateSpan(latitudeDelta: 0.02, longitudeDelta: 0.03))
        let rect = SpotMapCluster.mapRect(for: region)
        let back = MKCoordinateRegion(rect)
        #expect(abs(back.center.latitude - 35.71) < 1e-6 && abs(back.center.longitude - 139.77) < 1e-6)
        #expect(abs(back.span.longitudeDelta - 0.03) < 1e-6)
    }

    @Test func aDenseTileStillSendsTheWatchABoundedDecodableSnapshot() throws {
        let origin = SpotCoordinate(latitude: 35.7112, longitude: 139.77377)
        let dense = try mapped(tile, spots: (1...2_223).map { spot($0, in: tile) }).spots
        let snapshot = WatchSnapshotBuilder.build(spots: dense, sources: [], near: origin)
        let decoded = try WatchCodec.snapshot(WatchCodec.encode(snapshot))
        #expect(decoded.spots.count == 500)
        #expect(Set(decoded.spots.map(\.id)).count == 500)
        #expect(Set(decoded.spots.flatMap(\.sourceIDs)).isSubset(of: Set(decoded.sources.map(\.id))))
    }

    // MARK: fixtures

    private func pin(_ id: String) -> SpotMapPin {
        SpotMapPin(id: id, title: id, coordinate: SpotCoordinate(latitude: 35, longitude: 139),
                   existence: .official, accessibilityValue: "")
    }

    private func config(zoom: Int, tile: Int = 2, minimumTile: Int = 1) -> Data {
        try! JSONSerialization.data(withJSONObject: [
            "schemaVersion": 1, "apiVersion": "v1", "dataTileZoom": zoom,
            "schemaVersions": ["tile": tile, "spotDetail": 1, "report": 2],
            "minimumSupportedSchemaVersions": ["tile": minimumTile, "spotDetail": 1, "report": 1],
        ])
    }

    private func problem(_ status: Int, _ error: String) -> TileHTTPResponse {
        TileHTTPResponse(statusCode: status, body: Data(#"{"error":"\#(error)","detail":"test"}"#.utf8), etag: nil)
    }

    private func sha(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private var source: [String: Any] {
        ["id": sourceID, "displayName": "Approved ward source", "licenseName": "CC BY 4.0",
         "licenseUrl": "https://example.org/license", "attributionText": "Ward attribution"]
    }

    private func partBody(index: Int, count: Int, spots: [[String: Any]]) throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "schemaVersion": 2, "tile": tile.id, "part": index, "partCount": count, "spots": spots, "sources": [source],
        ])
    }

    private func manifestBody(revision: Int, parts: [Data]) throws -> Data {
        let counts = try parts.map { ((try JSONSerialization.jsonObject(with: $0) as! [String: Any])["spots"] as! [Any]).count }
        return try JSONSerialization.data(withJSONObject: [
            "schemaVersion": 2, "tile": tile.id, "revision": revision, "generatedAt": "2026-10-01T00:00:00Z",
            "partPolicy": "tile-parts.v1", "spotCount": counts.reduce(0, +),
            "parts": parts.enumerated().map { ["index": $0.offset, "spotCount": counts[$0.offset], "sha256": sha($0.element)] },
        ])
    }

    private func v1Body(spots: [[String: Any]]) throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "schemaVersion": 1, "tile": tile.id, "revision": 1, "generatedAt": "2026-10-01T00:00:00Z",
            "spots": spots, "sources": [source],
        ])
    }

    private func mapped(_ tile: SlippyTile, spots: [[String: Any]]) throws -> MappedTile {
        try TileSpotMapper.map(JSONDecoder().decode(TileBodyV1.self, from: v1Body(spots: spots)), requestedTile: tile)
    }

    private func spotID(_ number: Int) -> String {
        let suffix = String(number)
        return "sp_" + String(repeating: "0", count: 26 - suffix.count) + suffix
    }

    /// Spots spread inside the test tile (z14 14553/6449), like a station plaza.
    private func spot(_ number: Int, in tile: SlippyTile) -> [String: Any] {
        [
            "id": spotID(number), "name": "Spot \(number)",
            "latitude": 35.7112 + Double(number % 50) * 0.00001, "longitude": 139.77377 + Double(number / 50) * 0.00001,
            "spotType": "ashtray", "accessType": "public", "environment": "outdoor",
            "supportsPaper": "unknown", "supportsHeated": "unknown",
            "openingHours": ["status": "none", "raw": NSNull(), "parsed": NSNull(), "timeZone": "Asia/Tokyo"],
            "lifecycle": "active", "evidenceQuality": "officialListing",
            "evidenceQualityVersion": "evidence-quality.v1", "lastVerifiedAt": "2026-08-18", "sourceIds": [sourceID],
        ]
    }

    private func cachePath() -> String {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("mannerpath-tile-v2-tests-\(UUID().uuidString).sqlite").path
    }
}
