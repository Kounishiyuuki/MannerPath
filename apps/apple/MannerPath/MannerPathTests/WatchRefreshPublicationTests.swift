import Foundation
import Testing
@testable import MannerPath

/// Refresh confirmations are distinct from cached-corpus delivery. Synthetic, on-device-only data.
@MainActor
struct WatchRefreshPublicationTests {
    private let origin = SpotCoordinate(latitude: 36.578, longitude: 136.648)

    @Test(arguments: [0, 2])
    func completedRefreshConfirmsEmptyAndPopulatedAreasAndExplicitRetry(count: Int) async throws {
        let tile = try homeTile()
        let rows = (0..<count).map { spot("synthetic-\($0)", tile: tile) }
        let store = ConfirmationStore(rows: [tile.id: rows])
        let location = ConfirmationLocation(observed: deviceLocation())
        let model = NearbyModel(location: location, repository: store, refresher: store)
        var received: [([Spot], [SpotSource], SpotCoordinate, Date)] = []
        model.onConfirmedCorpusRefresh = { received.append(($0, $1, $2, $3)) }
        let before = Date()
        model.start()
        #expect(await waitUntil { received.count == 1 })
        #expect(Set(received.first?.0.map(\.id) ?? []) == Set(rows.map(\.id)))
        #expect(received.first?.2 == origin)
        let confirmedAt = try #require(received.first?.3)
        #expect(confirmedAt >= before && confirmedAt <= Date())
        #expect(confirmedAt > deviceLocation().timestamp, "refresh time is not the location observation time")
        #expect(model.dataState == .refreshed)
        #expect(model.refreshFailure == nil)
        #expect(await store.refreshCount() == 9)
        model.refresh()
        #expect(await waitUntil { received.count == 2 })
        #expect(await store.refreshCount() == 18)
        #expect(received[1].3 >= received[0].3)
    }

    @Test func cacheOnlyDeliveryNeverConfirmsNetworkRefresh() async throws {
        let tile = try homeTile()
        let store = ConfirmationStore(rows: [tile.id: [spot("saved", tile: tile)]])
        let model = NearbyModel(location: ConfirmationLocation(observed: deviceLocation()), repository: store, refresher: nil)
        var confirmations = 0
        var cachedDeliveries = 0
        model.onConfirmedCorpusRefresh = { _, _, _, _ in confirmations += 1 }
        model.onCachedCorpusChange = { _, _, _ in cachedDeliveries += 1 }
        model.start()
        #expect(await waitUntil { model.dataState == .cacheOnly })
        model.publishCachedCorpusForWatch()
        #expect(cachedDeliveries > 0)
        #expect(confirmations == 0)
    }

    @Test func corruptInitialCacheCannotReplaceSavedWatchCorpusWithFalseEmpty() async {
        let store = ConfirmationStore(corruptInitialRead: true)
        let model = NearbyModel(location: ConfirmationLocation(observed: deviceLocation()), repository: store, refresher: nil)
        var cachedDeliveries = 0
        var confirmations = 0
        model.onCachedCorpusChange = { _, _, _ in cachedDeliveries += 1 }
        model.onConfirmedCorpusRefresh = { _, _, _, _ in confirmations += 1 }
        model.start()
        #expect(await waitUntil { model.dataState == .refreshFailed })
        model.publishCachedCorpusForWatch()
        #expect(cachedDeliveries == 0)
        #expect(confirmations == 0)
    }

    @Test(arguments: ["prepare", "partial", "all", "corrupt"])
    func failedOrIncompleteRefreshNeverConfirms(mode: String) async throws {
        let tile = try homeTile()
        let failures: Set<String> = mode == "all" ? Set(tile.neighborhood3x3().map(\.id)) : mode == "partial" ? [tile.id] : []
        let store = ConfirmationStore(rows: [tile.id: [spot("saved", tile: tile)]], failing: failures,
                                      prepareFails: mode == "prepare", corruptFinalRead: mode == "corrupt")
        let model = NearbyModel(location: ConfirmationLocation(observed: deviceLocation()), repository: store, refresher: store)
        var confirmations = 0
        model.onConfirmedCorpusRefresh = { _, _, _, _ in confirmations += 1 }
        model.start()
        #expect(await waitUntil { model.dataState == .refreshFailed })
        #expect(confirmations == 0)
    }

    @Test(arguments: [0, 2], ["connection", "timeout", "unknown"])
    func failedRefreshPreservesSavedResultsAndRecovers(count: Int, failure: String) async throws {
        for phase in ["prepare", "tile"] {
            let tile = try homeTile()
            let rows = (0..<count).map { spot("saved-\($0)", tile: tile) }
            let store = ConfirmationStore(rows: [tile.id: rows], networkFailure: failure, failurePhase: phase)
            let model = NearbyModel(location: ConfirmationLocation(observed: deviceLocation()), repository: store, refresher: store)
            var confirmations = 0
            model.onConfirmedCorpusRefresh = { _, _, _, _ in confirmations += 1 }
            model.start()
            #expect(await waitUntil { model.dataState == .refreshFailed })
            let expected: NearbyRefreshFailure = failure == "connection" ? .connectionUnavailable : failure == "timeout" ? .timedOut : .unknown
            #expect(model.refreshFailure == expected)
            #expect(Set(model.results.map { $0.spot.id }) == Set(rows.map(\.id)))
            #expect(confirmations == 0, "An empty cache plus a failed request is not confirmed zero coverage")

            await store.restoreConnection()
            model.refresh()
            #expect(await waitUntil { model.dataState == .refreshed })
            #expect(model.refreshFailure == nil)
            #expect(Set(model.results.map { $0.spot.id }) == Set(rows.map(\.id)))
            #expect(confirmations == 1)
        }
    }

    @Test func lastKnownLocationCannotConfirmCurrentAreaRefresh() async throws {
        let store = ConfirmationStore()
        let model = NearbyModel(location: ConfirmationLocation(observed: deviceLocation(lastKnown: true)), repository: store, refresher: store)
        var confirmations = 0
        model.onConfirmedCorpusRefresh = { _, _, _, _ in confirmations += 1 }
        model.start()
        #expect(await waitUntil { model.dataState == .refreshed })
        #expect(confirmations == 0)
    }

    @Test func oldUnflaggedLocationCannotConfirmCurrentAreaRefresh() async throws {
        let store = ConfirmationStore()
        let observed = DeviceLocation(coordinate: origin, timestamp: Date().addingTimeInterval(-120),
                                      horizontalAccuracyMeters: 20, isApproximate: false, isLastKnown: false)
        let model = NearbyModel(location: ConfirmationLocation(observed: observed), repository: store, refresher: store)
        var confirmations = 0
        model.onConfirmedCorpusRefresh = { _, _, _, _ in confirmations += 1 }
        model.start()
        #expect(await waitUntil { model.dataState == .refreshed })
        #expect(confirmations == 0)
    }

    @Test func destinationRefreshCannotConfirmDeviceCorpus() async throws {
        let store = ConfirmationStore()
        let model = NearbyModel(location: ConfirmationLocation(observed: deviceLocation()), repository: store, refresher: store)
        var confirmations = 0
        model.onConfirmedCorpusRefresh = { _, _, _, _ in confirmations += 1 }
        model.selectDestination(PlaceDestination(id: UUID(), name: "Synthetic destination", coordinate: origin))
        #expect(await waitUntil { model.dataState == .refreshed })
        #expect(confirmations == 0)
    }

    private func homeTile() throws -> SlippyTile {
        try SlippyTile.forCoordinate(latitude: origin.latitude, longitude: origin.longitude, zoom: SlippyTile.defaultDataZoom)
    }
    private func deviceLocation(lastKnown: Bool = false) -> DeviceLocation {
        DeviceLocation(coordinate: origin, timestamp: Date().addingTimeInterval(-30),
                       horizontalAccuracyMeters: 20, isApproximate: false, isLastKnown: lastKnown)
    }
    private func spot(_ id: String, tile: SlippyTile) -> Spot {
        Spot(id: id, mergedInto: nil, name: id, latitude: origin.latitude, longitude: origin.longitude,
             tileId: tile.id, spotType: .ashtray, hostType: nil, accessType: .unknown, environment: .unknown,
             supportsPaper: .unknown, supportsHeated: .unknown, openingHours: nil, feeType: nil, floor: nil,
             entranceNote: nil, lifecycle: .active,
             verification: SpotVerification(acceptedExistenceEvidence: .yes, evidenceQuality: "officialListing", sourceDisplayNames: ["Synthetic source"]),
             lastVerifiedAt: nil, createdAt: nil, updatedAt: nil)
    }
    private func waitUntil(_ condition: @escaping @MainActor () -> Bool) async -> Bool {
        for _ in 0..<400 {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(5))
        }
        return false
    }
}

@MainActor
private final class ConfirmationLocation: LocationProviding {
    private(set) var state: NearbyLocationState = .denied
    var onStateChange: (@MainActor (NearbyLocationState) -> Void)?
    let observed: DeviceLocation
    init(observed: DeviceLocation) { self.observed = observed }
    func refresh() {
        state = .usable(observed)
        onStateChange?(state)
    }
}

private enum ConfirmationFailure: Error { case unavailable }
private actor ConfirmationStore: CachedSpotRepository, NearbyTileRefreshing {
    let rows: [String: [Spot]]
    let failing: Set<String>
    let prepareFails: Bool
    let corruptFinalRead: Bool
    let corruptInitialRead: Bool
    private var refreshes = 0
    private var networkFailure: String?
    private let failurePhase: String
    init(rows: [String: [Spot]] = [:], failing: Set<String> = [], prepareFails: Bool = false, corruptFinalRead: Bool = false, corruptInitialRead: Bool = false, networkFailure: String? = nil, failurePhase: String = "tile") {
        self.rows = rows; self.failing = failing; self.prepareFails = prepareFails; self.corruptFinalRead = corruptFinalRead
        self.corruptInitialRead = corruptInitialRead
        self.networkFailure = networkFailure; self.failurePhase = failurePhase
    }
    func spots(inTile tileID: String) async throws -> [Spot] {
        if corruptInitialRead || (corruptFinalRead && refreshes > 0) { throw ConfirmationFailure.unavailable }
        return rows[tileID] ?? []
    }
    func sources(inTile tileID: String) async throws -> [SpotSource] { [] }
    func dataZoom() async throws -> Int { SlippyTile.defaultDataZoom }
    func prepare() async throws -> Int {
        if failurePhase == "prepare" { try throwNetworkFailure() }
        if prepareFails { throw ConfirmationFailure.unavailable }
        return SlippyTile.defaultDataZoom
    }
    func refresh(_ tile: SlippyTile) async throws {
        refreshes += 1
        if failurePhase == "tile" { try throwNetworkFailure() }
        if failing.contains(tile.id) { throw ConfirmationFailure.unavailable }
    }
    func refreshCount() -> Int { refreshes }
    func restoreConnection() { networkFailure = nil }
    private func throwNetworkFailure() throws {
        switch networkFailure {
        case "connection": throw URLError(.notConnectedToInternet)
        case "timeout": throw URLError(.timedOut)
        case .some: throw ConfirmationFailure.unavailable
        case nil: return
        }
    }
}
