import Foundation
import Testing
@testable import MannerPath

private actor QueuedTileTransport: TileHTTPTransport {
    private var responses: [TileHTTPResponse]
    private var requests: [URLRequest] = []

    init(_ responses: [TileHTTPResponse]) {
        self.responses = responses
    }

    func send(_ request: URLRequest) async throws -> TileHTTPResponse {
        requests.append(request)
        guard !responses.isEmpty else { throw TransportError.noResponse }
        return responses.removeFirst()
    }

    func sentRequests() -> [URLRequest] { requests }

    private enum TransportError: Error { case noResponse }
}

private actor ReorderedTileTransport: TileHTTPTransport {
    private let older: TileHTTPResponse
    private let newer: TileHTTPResponse
    private var requestCount = 0
    private var firstRequestWaiter: CheckedContinuation<Void, Never>?
    private var olderResponseWaiter: CheckedContinuation<TileHTTPResponse, Never>?

    init(older: TileHTTPResponse, newer: TileHTTPResponse) {
        self.older = older
        self.newer = newer
    }

    func send(_ request: URLRequest) async throws -> TileHTTPResponse {
        requestCount += 1
        if requestCount == 1 {
            firstRequestWaiter?.resume()
            firstRequestWaiter = nil
            return await withCheckedContinuation { olderResponseWaiter = $0 }
        }
        return newer
    }

    func waitForFirstRequest() async {
        if requestCount > 0 { return }
        await withCheckedContinuation { firstRequestWaiter = $0 }
    }

    func releaseOlderResponse() {
        olderResponseWaiter?.resume(returning: older)
        olderResponseWaiter = nil
    }
}

struct TileSyncTests {
    private let tile = SlippyTile(z: 14, x: 14553, y: 6449)!
    private let sourceID = "approved-municipal-source"
    private let etagA = #""1-ExactAbC123""#
    private let etagB = #""1-NextXYZ789""#

    @Test func backendV1DTOAndStructuredHoursMapWithoutGuessing() throws {
        let data = try body(spots: [
            spot(1, spotType: "unknown", hours: allDayHours),
            spot(2, spotType: "ashtray", hours: dailyHours),
            spot(3, spotType: "ashtray", hours: unparsedHours)
        ])
        let dto = try JSONDecoder().decode(TileBodyV1.self, from: data)
        #expect(dto.schemaVersion == 1)
        #expect(dto.tile == tile.id)
        #expect(dto.spots.count == 3)
        #expect(dto.sources.count == 1)

        let mapped = try TileSpotMapper.map(dto, requestedTile: tile)
        #expect(mapped.spots.map(\.spotType) == [.unknown, .ashtray, .ashtray])
        #expect(mapped.spots[0].openingHours?.status == .parsed)
        #expect(mapped.spots[0].openingHours?.parsed?.version == 1)
        #expect(mapped.spots[0].openingHours?.parsed?.kind == .allDay)
        #expect(mapped.spots[1].openingHours?.parsed?.kind == .daily)
        #expect(mapped.spots[1].openingHours?.parsed?.opens == "07:00")
        #expect(mapped.spots[1].openingHours?.parsed?.closes == "24:00")
        #expect(mapped.spots[2].openingHours?.status == .unparsed)
        #expect(mapped.spots[2].openingHours?.parsed?.kind == nil)
        #expect(mapped.spots[2].openingHours?.raw == "休業日あり")
    }

    @Test func futureEnumValueDoesNotDiscardOtherSpots() throws {
        let data = try body(spots: [
            spot(1, spotType: "futureType"),
            spot(2, spotType: "unknown", accessType: "futureAccess", supportsPaper: "futureSupport")
        ])
        let dto = try JSONDecoder().decode(TileBodyV1.self, from: data)
        let mapped = try TileSpotMapper.map(dto, requestedTile: tile)

        #expect(mapped.spots.count == 2)
        #expect(mapped.spots[0].spotType == .unsupported)
        #expect(mapped.spots[1].spotType == .unknown)
        #expect(mapped.spots[1].accessType == .unknown)
        #expect(mapped.spots[1].supportsPaper == .unknown)
        #expect(mapped.spots[1].verification.acceptedExistenceEvidence == .yes)
    }

    @Test func first200PersistsCompleteTileAndOfflineAttribution() async throws {
        let path = cachePath()
        let store = try GRDBTileStore(path: path)
        let transport = QueuedTileTransport([
            TileHTTPResponse(statusCode: 200, body: try body(spots: [spot(1)]), etag: etagA)
        ])
        let service = makeService(transport: transport, store: store)

        let synced = try await service.sync(tile)
        #expect(synced.tileID == tile.id)
        #expect(synced.revision == 1)
        #expect(synced.generatedAt != nil)
        #expect(synced.etag == etagA)
        #expect(synced.spots.map(\.id) == [spotID(1)])
        #expect(synced.spots[0].spotType == .unknown)

        let requests = await transport.sentRequests()
        #expect(requests.count == 1)
        #expect(requests[0].url?.path == "/v1/tiles/14/14553/6449")
        #expect(requests[0].value(forHTTPHeaderField: "If-None-Match") == nil)

        let offlineStore = try GRDBTileStore(path: path)
        let offline = try #require(await offlineStore.cachedTile(tile))
        #expect(offline.spots.map(\.id) == [spotID(1)])
        #expect(offline.sources.map(\.id) == [sourceID])
        #expect(offline.sources[0].displayName == "Approved ward source")
        #expect(offline.sources[0].licenseName == "CC BY 4.0")
        #expect(offline.sources[0].licenseURL == "https://example.org/license")
        #expect(offline.sources[0].attributionText == "Ward attribution")
        #expect(offline.spots[0].verification.sources?.map(\.id) == [sourceID])
        #expect(offline.spots[0].verification.sourceDisplayNames == ["Approved ward source"])
        #expect(try await offlineStore.spots(inTile: tile.id).map(\.id) == [spotID(1)])
    }

    @Test func second200ReplacesMembershipAndETag() async throws {
        let store = try GRDBTileStore(path: cachePath())
        let transport = QueuedTileTransport([
            TileHTTPResponse(statusCode: 200, body: try body(spots: [spot(1), spot(2)]), etag: etagA),
            TileHTTPResponse(statusCode: 200, body: try body(revision: 2, spots: [spot(2), spot(3)]), etag: etagB)
        ])
        let service = makeService(transport: transport, store: store)

        _ = try await service.sync(tile)
        let replaced = try await service.sync(tile)
        #expect(Set(replaced.spots.map(\.id)) == Set([spotID(2), spotID(3)]))
        #expect(replaced.revision == 2)
        #expect(replaced.etag == etagB)
        #expect(Set(try await store.spots(inTile: tile.id).map(\.id)) == Set([spotID(2), spotID(3)]))
    }

    @Test func notModifiedPreservesSnapshotAndReusesExactETag() async throws {
        let store = try GRDBTileStore(path: cachePath())
        let transport = QueuedTileTransport([
            TileHTTPResponse(statusCode: 200, body: try body(spots: [spot(1)]), etag: etagA),
            TileHTTPResponse(statusCode: 304, body: Data(), etag: etagA)
        ])
        let service = makeService(transport: transport, store: store)

        let initial = try await service.sync(tile)
        let unchanged = try await service.sync(tile)
        #expect(unchanged.revision == initial.revision)
        #expect(unchanged.generatedAt == initial.generatedAt)
        #expect(unchanged.etag == initial.etag)
        #expect(unchanged.spots.map(\.id) == initial.spots.map(\.id))
        #expect(unchanged.sources.map(\.id) == initial.sources.map(\.id))

        let requests = await transport.sentRequests()
        #expect(requests.count == 2)
        #expect(requests[1].value(forHTTPHeaderField: "If-None-Match") == etagA)
    }

    @Test func valid404ClearsPreviouslyPublishedTile() async throws {
        let store = try GRDBTileStore(path: cachePath())
        let transport = QueuedTileTransport([
            TileHTTPResponse(statusCode: 200, body: try body(spots: [spot(1)]), etag: etagA),
            TileHTTPResponse(statusCode: 404, body: Data(#"{"error":"tileNotPublished","detail":"No snapshot"}"#.utf8), etag: nil)
        ])
        let service = makeService(transport: transport, store: store)

        _ = try await service.sync(tile)
        let cleared = try await service.sync(tile)
        #expect(cleared.spots.isEmpty)
        #expect(cleared.sources.isEmpty)
        #expect(cleared.etag == nil)
        #expect(try await store.spots(inTile: tile.id).isEmpty)
        #expect(try await store.cachedTile(tile)?.spots.isEmpty == true)
    }

    @Test func unsupportedSchemaDoesNotCorruptCachedSnapshot() async throws {
        var unsupported = try JSONSerialization.jsonObject(with: body(spots: [spot(2)])) as! [String: Any]
        unsupported["schemaVersion"] = 2
        let incompatible = try JSONSerialization.data(withJSONObject: unsupported)
        let store = try GRDBTileStore(path: cachePath())
        let transport = QueuedTileTransport([
            TileHTTPResponse(statusCode: 200, body: try body(spots: [spot(1)]), etag: etagA),
            TileHTTPResponse(statusCode: 200, body: incompatible, etag: etagB)
        ])
        let service = makeService(transport: transport, store: store)

        _ = try await service.sync(tile)
        do {
            _ = try await service.sync(tile)
            Issue.record("Unsupported schemaVersion was accepted")
        } catch {
            #expect(error as? TileSyncError == .unsupportedSchemaVersion(2))
        }
        let cached = try #require(await store.cachedTile(tile))
        #expect(cached.spots.map(\.id) == [spotID(1)])
        #expect(cached.etag == etagA)
    }

    @Test func malformed200AndErrorResponseNeverDeleteGoodCache() async throws {
        var misplacedSpot = spot(2)
        misplacedSpot["latitude"] = 35.8
        var invalidIDSpot = spot(3)
        invalidIDSpot["id"] = "not-a-canonical-spot-id"
        let store = try GRDBTileStore(path: cachePath())
        let transport = QueuedTileTransport([
            TileHTTPResponse(statusCode: 200, body: try body(spots: [spot(1)]), etag: etagA),
            TileHTTPResponse(statusCode: 200, body: Data(#"{"schemaVersion":1,"spots":[]}"#.utf8), etag: etagB),
            TileHTTPResponse(statusCode: 200, body: try body(spots: [misplacedSpot]), etag: etagB),
            TileHTTPResponse(statusCode: 200, body: try body(spots: [invalidIDSpot]), etag: etagB),
            TileHTTPResponse(statusCode: 200, body: try body(spots: [spot(2)]), etag: nil),
            TileHTTPResponse(statusCode: 500, body: Data(#"{"error":"serverError"}"#.utf8), etag: nil)
        ])
        let service = makeService(transport: transport, store: store)

        _ = try await service.sync(tile)
        let expectedErrors: [TileSyncError] = [
            .malformedResponse, .malformedResponse, .malformedResponse,
            .missingETag, .httpStatus(500)
        ]
        for expected in expectedErrors {
            do {
                _ = try await service.sync(tile)
                Issue.record("Invalid response was accepted")
            } catch {
                #expect(error as? TileSyncError == expected)
            }
            let cached = try #require(await store.cachedTile(tile))
            #expect(cached.spots.map(\.id) == [spotID(1)])
            #expect(cached.etag == etagA)
        }
    }

    @Test func invalid404DoesNotClearGoodCache() async throws {
        let store = try GRDBTileStore(path: cachePath())
        let transport = QueuedTileTransport([
            TileHTTPResponse(statusCode: 200, body: try body(spots: [spot(1)]), etag: etagA),
            TileHTTPResponse(statusCode: 404, body: Data(#"{"error":"notFound"}"#.utf8), etag: nil)
        ])
        let service = makeService(transport: transport, store: store)

        _ = try await service.sync(tile)
        do {
            _ = try await service.sync(tile)
            Issue.record("Unrecognized 404 cleared a published tile")
        } catch {
            #expect(error as? TileSyncError == .httpStatus(404))
        }
        #expect(try await store.cachedTile(tile)?.spots.map(\.id) == [spotID(1)])
    }

    @Test func failedDatabaseReplacementRollsBackMembershipAndMetadata() async throws {
        let store = try GRDBTileStore(path: cachePath())
        let original = try TileSpotMapper.map(
            JSONDecoder().decode(TileBodyV1.self, from: body(spots: [spot(1)])),
            requestedTile: tile
        )
        try await store.replace(original, etag: etagA)

        let duplicate = try TileSpotMapper.map(
            JSONDecoder().decode(TileBodyV1.self, from: body(revision: 2, spots: [spot(2), spot(2)])),
            requestedTile: tile
        )
        do {
            try await store.replace(duplicate, etag: etagB)
            Issue.record("Duplicate spot IDs did not fail the replacement transaction")
        } catch {}

        let cached = try #require(await store.cachedTile(tile))
        #expect(cached.revision == 1)
        #expect(cached.etag == etagA)
        #expect(cached.spots.map(\.id) == [spotID(1)])
        #expect(cached.sources.map(\.id) == [sourceID])
    }

    @Test(arguments: [200, 404])
    func lateOlderResponseCannotOverwriteNewerSnapshot(olderStatus: Int) async throws {
        let older = TileHTTPResponse(
            statusCode: olderStatus,
            body: olderStatus == 200
                ? try body(spots: [spot(1)])
                : Data(#"{"error":"tileNotPublished","detail":"No snapshot"}"#.utf8),
            etag: olderStatus == 200 ? etagA : nil
        )
        let newer = TileHTTPResponse(
            statusCode: 200,
            body: try body(revision: 2, spots: [spot(2)]),
            etag: etagB
        )
        let transport = ReorderedTileTransport(older: older, newer: newer)
        let client = TileAPIClient(baseURL: URL(string: "https://tiles.example.invalid")!, transport: transport)
        let store = try GRDBTileStore(path: cachePath())
        let firstService = TileSyncService(client: client, store: store)
        let secondService = TileSyncService(client: client, store: store)

        let olderTask = Task { try await firstService.sync(tile) }
        await transport.waitForFirstRequest()
        let newerTask = Task { try await secondService.sync(tile) }
        let latest = try await newerTask.value
        #expect(latest.revision == 2)
        await transport.releaseOlderResponse()
        _ = try await olderTask.value

        let cached = try #require(await store.cachedTile(tile))
        #expect(cached.revision == 2)
        #expect(cached.etag == etagB)
        #expect(cached.spots.map(\.id) == [spotID(2)])
    }

    @Test(arguments: [304, 500])
    func newerUnappliedResponseDoesNotDiscardOlderValidSnapshot(newerStatus: Int) async throws {
        let store = try GRDBTileStore(path: cachePath())
        if newerStatus == 304 {
            let seed = try TileSpotMapper.map(
                JSONDecoder().decode(TileBodyV1.self, from: body(spots: [spot(1)])),
                requestedTile: tile
            )
            try await store.replace(seed, etag: etagA)
        }
        let older = TileHTTPResponse(
            statusCode: 200,
            body: try body(revision: newerStatus == 304 ? 2 : 1, spots: [spot(2)]),
            etag: etagB
        )
        let newer = TileHTTPResponse(
            statusCode: newerStatus,
            body: newerStatus == 304 ? Data() : Data(#"{"error":"serverError"}"#.utf8),
            etag: newerStatus == 304 ? etagA : nil
        )
        let transport = ReorderedTileTransport(older: older, newer: newer)
        let client = TileAPIClient(baseURL: URL(string: "https://tiles.example.invalid")!, transport: transport)
        let firstService = TileSyncService(client: client, store: store)
        let secondService = TileSyncService(client: client, store: store)

        let olderTask = Task { try await firstService.sync(tile) }
        await transport.waitForFirstRequest()
        let newerTask = Task { try await secondService.sync(tile) }
        if newerStatus == 304 {
            let unchanged = try await newerTask.value
            #expect(unchanged.revision == 1)
        } else {
            do {
                _ = try await newerTask.value
                Issue.record("Server error was accepted")
            } catch {}
        }
        await transport.releaseOlderResponse()
        _ = try await olderTask.value

        let cached = try #require(await store.cachedTile(tile))
        #expect(cached.revision == (newerStatus == 304 ? 2 : 1))
        #expect(cached.etag == etagB)
        #expect(cached.spots.map(\.id) == [spotID(2)])
    }

    private func makeService(transport: QueuedTileTransport, store: GRDBTileStore) -> TileSyncService {
        let client = TileAPIClient(baseURL: URL(string: "https://tiles.example.invalid")!, transport: transport)
        return TileSyncService(client: client, store: store)
    }

    private func cachePath() -> String {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("mannerpath-tile-tests-\(UUID().uuidString).sqlite")
            .path
    }

    private func spotID(_ number: Int) -> String {
        "sp_" + String(repeating: "0", count: 25) + String(number)
    }

    private func spot(
        _ number: Int,
        spotType: String = "unknown",
        accessType: String = "unknown",
        supportsPaper: String = "unknown",
        hours: [String: Any]? = nil
    ) -> [String: Any] {
        [
            "id": spotID(number), "name": "Spot \(number)",
            "latitude": 35.7112, "longitude": 139.77377,
            "spotType": spotType, "accessType": accessType, "environment": "unknown",
            "supportsPaper": supportsPaper, "supportsHeated": "unknown",
            "openingHours": hours ?? allDayHours,
            "lifecycle": "active", "evidenceQuality": "officialListing",
            "evidenceQualityVersion": "evidence-quality.v1",
            "lastVerifiedAt": "2026-08-18", "sourceIds": [sourceID]
        ]
    }

    private var allDayHours: [String: Any] {
        ["status": "parsed", "raw": "終日利用可能",
         "parsed": ["v": 1, "kind": "allDay"], "timeZone": "Asia/Tokyo"]
    }

    private var dailyHours: [String: Any] {
        ["status": "parsed", "raw": "07:00-24:00",
         "parsed": ["v": 1, "kind": "daily", "opens": "07:00", "closes": "24:00"],
         "timeZone": "Asia/Tokyo"]
    }

    private var unparsedHours: [String: Any] {
        ["status": "unparsed", "raw": "休業日あり", "parsed": NSNull(), "timeZone": "Asia/Tokyo"]
    }

    private func body(revision: Int = 1, spots: [[String: Any]]) throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "schemaVersion": 1, "tile": tile.id, "revision": revision,
            "generatedAt": "2026-09-21T00:00:00Z", "spots": spots,
            "sources": [[
                "id": sourceID, "displayName": "Approved ward source",
                "licenseName": "CC BY 4.0", "licenseUrl": "https://example.org/license",
                "attributionText": "Ward attribution"
            ]]
        ])
    }
}
