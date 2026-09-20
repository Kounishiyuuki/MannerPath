import Foundation
import Testing
@testable import MannerPath

@MainActor
struct RouteSearchTests {
    private let origin = SpotCoordinate(latitude: 35, longitude: 139)
    private let destination = SpotCoordinate(latitude: 35, longitude: 139.01)

    @Test func confirmedFiltersPreserveUnknownAndNoAsDifferentValues() {
        let spots = [
            spot("unknown", offset: 0.001, access: .unknown, environment: .unknown,
                 paper: .unknown, heated: .unknown),
            spot("no", offset: 0.002, access: .customerOnly, environment: .indoor,
                 paper: .no, heated: .no),
            spot("confirmed", offset: 0.003, access: .public, environment: .outdoor,
                 paper: .yes, heated: .yes)
        ]
        var filters = NearbyFilters()
        filters.tobaccoType = .paper
        #expect(ids(spots, filters: filters) == ["unknown", "confirmed"])
        filters.requireConfirmedTobaccoSupport = true
        #expect(ids(spots, filters: filters) == ["confirmed"])
        filters.tobaccoType = .heated
        #expect(ids(spots, filters: filters) == ["confirmed"])
        filters.requireConfirmedTobaccoSupport = false
        filters.publicAccessOnly = true
        #expect(ids(spots, filters: filters) == ["unknown", "confirmed"])
        filters.requireConfirmedPublicAccess = true
        #expect(ids(spots, filters: filters) == ["confirmed"])
        filters.accessTypes = [.unknown]
        #expect(ids(spots, filters: filters).isEmpty)
        filters.publicAccessOnly = false
        filters.requireConfirmedPublicAccess = false
        #expect(ids(spots, filters: filters) == ["unknown"])
        filters.accessTypes = [.public]
        #expect(ids(spots, filters: filters) == ["confirmed"])
        filters.environments = [.outdoor]
        #expect(ids(spots, filters: filters) == ["confirmed"])
        filters.environments = [.unknown]
        #expect(ids(spots, filters: filters).isEmpty)
    }

    @Test func openNowRequiresParsedKnownHoursAndOfficialEvidenceRequiresVersion() {
        let open = hours(status: .parsed, kind: .daily, opens: "09:00", closes: "17:00")
        let closed = hours(status: .parsed, kind: .daily, opens: "11:00", closes: "17:00")
        let unparsed = hours(status: .unparsed, kind: .daily, opens: "09:00", closes: "17:00")
        let invalid = hours(status: .parsed, kind: .daily, opens: "bad", closes: "17:00")
        let atTenUTC = Date(timeIntervalSince1970: 10 * 3_600)
        #expect(NearbySearch.openNow(nil, at: atTenUTC) == .unknown)
        #expect(NearbySearch.openNow(unparsed, at: atTenUTC) == .unknown)
        #expect(NearbySearch.openNow(invalid, at: atTenUTC) == .unknown)
        #expect(NearbySearch.openNow(open, at: atTenUTC) == .yes)
        #expect(NearbySearch.openNow(closed, at: atTenUTC) == .no)
        #expect(NearbySearch.openNow(hours(status: .parsed, kind: .daily,
            opens: "21:00", closes: "00:00"), at: atTenUTC) == .no)

        let spots = [
            spot("unknown-hours", offset: 0.001),
            spot("unparsed", offset: 0.002, openingHours: unparsed),
            spot("closed", offset: 0.003, openingHours: closed),
            spot("unversioned", offset: 0.004, openingHours: open, evidence: "officialListing"),
            spot("other-evidence", offset: 0.005, openingHours: open, evidence: "communityReport",
                 evidenceVersion: "evidence-quality.v1"),
            spot("confirmed", offset: 0.006, openingHours: open, evidence: "officialListing",
                 evidenceVersion: "evidence-quality.v1")
        ]
        var filters = NearbyFilters()
        filters.openNowOnly = true
        #expect(NearbySearch.rank(spots, from: origin, filters: filters, at: atTenUTC)
            .map(\.spot.id) == ["unversioned", "other-evidence", "confirmed"])
        filters.officialEvidenceOnly = true
        #expect(NearbySearch.rank(spots, from: origin, filters: filters, at: atTenUTC)
            .map(\.spot.id) == ["confirmed"])
    }

    @Test func openNowReranksWhenReportedHoursReachClosingTime() async throws {
        let open = hours(status: .parsed, kind: .daily, opens: "09:00", closes: "11:00")
        let model = try makeModel(spots: [spot("closing", offset: 0.001, openingHours: open)])
        #expect(await waitUntil { model.results.count == 1 })
        var filters = NearbyFilters()
        filters.openNowOnly = true
        model.setFilters(filters)
        model.refreshTimeDependentResults(at: Date(timeIntervalSince1970: 10 * 3_600 + 59 * 60))
        #expect(model.results.map(\.spot.id) == ["closing"])
        model.refreshTimeDependentResults(at: Date(timeIntervalSince1970: 11 * 3_600))
        #expect(model.results.isEmpty)
        #expect(model.hasUnfilteredResults)
    }

    @Test func detourUsesThreeWalkingETAsAndRanksAheadOfRadius() {
        #expect(RouteDetourRanker.detourSeconds(direct: 600, viaSpot: 420, onward: 300) == 120)
        #expect(RouteDetourRanker.detourSeconds(direct: 600, viaSpot: 250, onward: 250) == 0)
        #expect(RouteDetourRanker.detourSeconds(direct: .nan, viaSpot: 250, onward: 250) == nil)
        #expect(RouteDetourRanker.detourSeconds(direct: 600, viaSpot: -1, onward: 250) == nil)

        let results = NearbySearch.rank([
            spot("near", offset: 0.001), spot("far", offset: 0.005), spot("unrouted", offset: 0.007)
        ], from: origin, at: .now)
        let ranked = RouteDetourRanker.rank(results, detours: ["near": 300, "far": 60])
        #expect(ranked.map(\.nearby.spot.id) == ["far", "near", "unrouted"])
        #expect(ranked.map(\.detourSeconds) == [60, 300, nil])
    }

    @Test func shortlistAndDirectionsBudgetStayBounded() async throws {
        let spots = (1...12).map { spot("spot-\($0)", offset: Double($0) * 0.0005) }
        let results = NearbySearch.rank(spots, from: origin, at: .now)
        let candidates = RouteDetourRanker.candidates(results, from: origin, to: destination)
        #expect(candidates.count == RouteDetourRanker.maximumRoutedCandidates)
        #expect(RouteDetourRanker.maximumDirectionsRequests == 1 + 2 * candidates.count)
        #expect(Set(candidates.map(\.spot.id)).count == candidates.count)

        let router = ImmediateRouter()
        let model = try makeModel(spots: spots, router: router)
        #expect(await waitUntil { model.results.count == spots.count })
        model.selectDestination(place(destination))
        #expect(await waitUntil { model.routeState == .ready })
        #expect(router.requests.count == RouteDetourRanker.maximumDirectionsRequests)
        #expect(model.routeResults.count == spots.count)
        var sameCandidates = NearbyFilters()
        sameCandidates.maximumDistanceMeters = 10_000
        model.setFilters(sameCandidates)
        #expect(model.routeState == .ready)
        try await Task.sleep(for: .milliseconds(300))
        #expect(router.requests.count == RouteDetourRanker.maximumDirectionsRequests)
    }

    @Test func lateRouteForOldDestinationCannotReplaceNewRoute() async throws {
        let router = ControlledRouter()
        let model = try makeModel(spots: [spot("cached", offset: 0.001)], router: router)
        #expect(await waitUntil { model.results.count == 1 })
        let first = place(destination)
        let second = place(SpotCoordinate(latitude: 35, longitude: 139.02))
        model.selectDestination(first)
        #expect(await waitUntil { router.requests.count == 1 })
        model.selectDestination(second)
        #expect(await waitUntil { router.requests.count == 2 })
        router.succeed(0, seconds: 500) // Deliberately completes after cancellation.
        #expect(await waitUntil { router.completed.contains(0) })
        await Task.yield()
        #expect(model.destination == second)
        #expect(model.routeState == .loading)
        #expect(router.requests.count == 2)
        router.succeed(1, seconds: 600)
        #expect(await waitUntil { router.requests.count == 3 })
        router.succeed(2, seconds: 250)
        #expect(await waitUntil { router.requests.count == 4 })
        router.succeed(3, seconds: 400)
        #expect(await waitUntil { model.routeState == .ready })
        #expect(model.routeResults.first?.detourSeconds == 50)
    }

    @Test func filterChangeInvalidatesLateRouteAndReranksCachedSpots() async throws {
        let router = ControlledRouter()
        let model = try makeModel(spots: [
            spot("unknown", offset: 0.001, paper: .unknown),
            spot("yes", offset: 0.002, paper: .yes)
        ], router: router)
        #expect(await waitUntil { model.results.count == 2 })
        model.selectDestination(place(destination))
        #expect(await waitUntil { router.requests.count == 1 })
        var filters = NearbyFilters()
        filters.tobaccoType = .paper
        filters.requireConfirmedTobaccoSupport = true
        model.setFilters(filters)
        #expect(model.results.map(\.spot.id) == ["yes"])
        #expect(model.routeResults.map(\.nearby.spot.id) == ["yes"])
        #expect(await waitUntil { router.requests.count == 2 })
        router.succeed(0, seconds: 100)
        #expect(await waitUntil { router.completed.contains(0) })
        await Task.yield()
        #expect(model.routeState == .loading)
        #expect(router.requests.count == 2)
        router.fail(1)
        #expect(await waitUntil { model.routeState == .unavailable })
        #expect(model.routeResults.map(\.nearby.spot.id) == ["yes"])
        #expect(model.routeResults.first?.detourSeconds == nil)
    }

    @Test func locationChangeInvalidatesLateRouteAndPreservesDistanceFallback() async throws {
        let router = ControlledRouter()
        let location = TestLocation(state: .usable(deviceLocation(origin)))
        let model = try makeModel(spots: [spot("cached", offset: 0.001)], router: router, location: location)
        #expect(await waitUntil { model.results.count == 1 })
        model.selectDestination(place(destination))
        #expect(await waitUntil { router.requests.count == 1 })
        let moved = SpotCoordinate(latitude: 35, longitude: 139.0002)
        location.send(.usable(deviceLocation(moved)))
        #expect(model.routeState == .unavailable)
        #expect(model.routeResults.first?.detourSeconds == nil)
        #expect(await waitUntil { model.resultsLocation?.coordinate == moved })
        #expect(await waitUntil { router.requests.count == 2 })
        router.succeed(0, seconds: 100)
        #expect(await waitUntil { router.completed.contains(0) })
        await Task.yield()
        #expect(model.routeState == .loading)
        router.fail(1)
        #expect(await waitUntil { model.routeState == .unavailable })
        #expect(model.results.map(\.spot.id) == ["cached"])
        #expect(model.routeResults.first?.nearby.distanceMeters == model.results.first?.distanceMeters)
        #expect(model.routeResults.first?.nearby.bearingDegrees == model.results.first?.bearingDegrees)
    }

    @Test func destinationSearchIsEphemeralAndSuppressesOlderMatches() async throws {
        let search = ControlledDestinationSearch()
        let model = try makeModel(spots: [spot("cached", offset: 0.001)], search: search)
        #expect(await waitUntil { model.results.count == 1 })
        model.searchDestination("first")
        #expect(await waitUntil { search.queries.count == 1 })
        model.searchDestination("second")
        #expect(await waitUntil { search.queries.count == 2 })
        let old = place(SpotCoordinate(latitude: 35, longitude: 139.02))
        let current = place(destination)
        search.succeed(0, matches: [old])
        #expect(await waitUntil { search.completed.contains(0) })
        await Task.yield()
        #expect(model.destinationMatches.isEmpty)
        search.succeed(1, matches: [current])
        #expect(await waitUntil { model.destinationMatches == [current] })
        #expect(search.queries.map(\.text) == ["first", "second"])
        #expect(search.queries.allSatisfy { $0.origin == origin })
        #expect(model.results.map(\.spot.id) == ["cached"])
        model.selectDestination(current)
        #expect(model.destinationMatches.isEmpty)
        #expect(model.results.map(\.spot.id) == ["cached"])
        model.selectDestination(nil)
        #expect(model.destination == nil)
        #expect(model.results.map(\.spot.id) == ["cached"])
    }

    private func ids(_ spots: [Spot], filters: NearbyFilters) -> [String] {
        NearbySearch.rank(spots, from: origin, filters: filters, at: .now).map(\.spot.id)
    }

    private func hours(status: SpotOpeningHours.Status, kind: SpotParsedOpeningHours.Kind,
                       opens: String?, closes: String?) -> SpotOpeningHours {
        SpotOpeningHours(raw: nil, parsed: SpotParsedOpeningHours(version: 1, kind: kind,
            opens: opens, closes: closes), status: status, timeZone: "UTC")
    }

    private func spot(_ id: String, offset: Double, access: AccessType = .public,
                      environment: SpotEnvironment = .outdoor, paper: TriState = .yes,
                      heated: TriState = .yes, openingHours: SpotOpeningHours? = nil,
                      evidence: String? = nil, evidenceVersion: String? = nil) -> Spot {
        Spot(id: id, mergedInto: nil, name: id, latitude: origin.latitude,
             longitude: origin.longitude + offset, tileId: "test-tile", spotType: .ashtray,
             hostType: nil, accessType: access, environment: environment,
             supportsPaper: paper, supportsHeated: heated, openingHours: openingHours,
             feeType: nil, floor: nil, entranceNote: nil, lifecycle: .active,
             verification: SpotVerification(acceptedExistenceEvidence: .yes,
                 evidenceQuality: evidence, sourceDisplayNames: [], evidenceQualityVersion: evidenceVersion),
             lastVerifiedAt: nil, createdAt: nil, updatedAt: nil)
    }

    private func place(_ coordinate: SpotCoordinate) -> PlaceDestination {
        PlaceDestination(id: UUID(), name: "Destination", coordinate: coordinate)
    }

    private func deviceLocation(_ coordinate: SpotCoordinate) -> DeviceLocation {
        DeviceLocation(coordinate: coordinate, timestamp: .now,
                       horizontalAccuracyMeters: 10, isApproximate: false, isLastKnown: false)
    }

    private func makeModel(spots: [Spot], router: (any WalkingRouting)? = nil,
                           search: (any DestinationSearching)? = nil,
                           location: TestLocation? = nil) throws -> NearbyModel {
        let tile = try SlippyTile.forCoordinate(latitude: origin.latitude,
            longitude: origin.longitude, zoom: SlippyTile.dataZoom)
        return NearbyModel(location: location ?? TestLocation(state: .usable(deviceLocation(origin))),
            repository: TestCache(tileID: tile.id, spots: spots), refresher: nil,
            destinationSearch: search, walkingRouter: router)
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
private final class TestLocation: LocationProviding {
    private(set) var state: NearbyLocationState
    var onStateChange: (@MainActor (NearbyLocationState) -> Void)?
    init(state: NearbyLocationState) { self.state = state }
    func refresh() {}
    func send(_ state: NearbyLocationState) {
        self.state = state
        onStateChange?(state)
    }
}

private struct TestCache: CachedSpotRepository {
    let tileID: String
    let spots: [Spot]
    func spots(inTile id: String) async throws -> [Spot] { id == tileID ? spots : [] }
    func sources(inTile id: String) async throws -> [SpotSource] { [] }
}

@MainActor
private final class ImmediateRouter: WalkingRouting {
    private(set) var requests: [(SpotCoordinate, SpotCoordinate)] = []
    func cancel() {}
    func route(from start: SpotCoordinate, to end: SpotCoordinate) async throws -> WalkingRoute {
        requests.append((start, end))
        return WalkingRoute(travelTime: 600, distanceMeters: 500, geometry: [])
    }
}

private enum TestRouteError: Error { case unavailable }

@MainActor
private final class ControlledRouter: WalkingRouting {
    private(set) var requests: [(SpotCoordinate, SpotCoordinate)] = []
    private(set) var completed: [Int] = []
    private var pending: [Int: CheckedContinuation<WalkingRoute, Error>] = [:]
    func cancel() {} // Simulates a late MKDirections completion despite cancellation.
    func route(from start: SpotCoordinate, to end: SpotCoordinate) async throws -> WalkingRoute {
        let index = requests.count
        requests.append((start, end))
        let result = try await withCheckedThrowingContinuation { pending[index] = $0 }
        completed.append(index)
        return result
    }
    func succeed(_ index: Int, seconds: TimeInterval) {
        pending.removeValue(forKey: index)?.resume(returning: WalkingRoute(
            travelTime: seconds, distanceMeters: 500, geometry: []))
    }
    func fail(_ index: Int) {
        pending.removeValue(forKey: index)?.resume(throwing: TestRouteError.unavailable)
    }
}

@MainActor
private final class ControlledDestinationSearch: DestinationSearching {
    private(set) var queries: [(text: String, origin: SpotCoordinate?)] = []
    private(set) var completed: [Int] = []
    private var pending: [Int: CheckedContinuation<[PlaceDestination], Error>] = [:]
    func search(_ text: String, near origin: SpotCoordinate?) async throws -> [PlaceDestination] {
        let index = queries.count
        queries.append((text, origin))
        let result = try await withCheckedThrowingContinuation { pending[index] = $0 }
        completed.append(index)
        return result
    }
    func succeed(_ index: Int, matches: [PlaceDestination]) {
        pending.removeValue(forKey: index)?.resume(returning: matches)
    }
}
