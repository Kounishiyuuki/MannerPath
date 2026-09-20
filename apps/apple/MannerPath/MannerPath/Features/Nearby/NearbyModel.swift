import Foundation
import Observation

enum NearbyDataState: Equatable {
    case waitingForLocation
    case readingCache
    case refreshing
    case refreshed
    case refreshFailed
    case cacheOnly
    case cacheUnavailable
}

enum RouteDataState: Equatable {
    case idle, loading, ready, unavailable
}

@Observable
@MainActor
final class NearbyModel {
    private let location: any LocationProviding
    private let repository: (any CachedSpotRepository)?
    private let refresher: (any NearbyTileRefreshing)?
    private let destinationSearch: (any DestinationSearching)?
    private let walkingRouter: (any WalkingRouting)?
    private var loadTask: Task<Void, Never>?
    private var searchTask: Task<Void, Never>?
    private var routeTask: Task<Void, Never>?
    private var clockTask: Task<Void, Never>?
    private var generation = 0
    private var searchGeneration = 0
    private var routeGeneration = 0
    private var activeTileIDs: Set<String> = []
    private var cachedSpots: [Spot] = []
    private var lastRouteKey: RouteRequestKey?
    private var lastDetours: [String: TimeInterval] = [:]
    private var lastRouteComputedAt: Date?
    var onCachedCorpusChange: (([Spot], [SpotSource], SpotCoordinate) -> Void)?

    private(set) var filters = NearbyFilters()
    private(set) var destinationMatches: [PlaceDestination] = []
    private(set) var destination: PlaceDestination?
    private(set) var destinationSearchFailed = false
    private(set) var searchingDestination = false
    private(set) var routeState: RouteDataState = .idle
    private(set) var routeResults: [RouteRankedResult] = []

    private(set) var locationState: NearbyLocationState
    private(set) var dataState: NearbyDataState = .waitingForLocation
    private(set) var results: [NearbyResult] = []
    private(set) var resultsLocation: DeviceLocation?
    private(set) var sources: [SpotSource] = []
    private var lastUsableLocation: DeviceLocation?

    var displayLocation: DeviceLocation? {
        switch locationState {
        case .usable(let location): location
        case .locating: lastUsableLocation
        default: nil
        }
    }

    func result(id: String) -> NearbyResult? {
        results.first { $0.spot.id == id }
    }

    var hasUnfilteredResults: Bool {
        guard let origin = resultsLocation?.coordinate else { return false }
        return !NearbySearch.rank(cachedSpots, from: origin, at: Date()).isEmpty
    }

    func publishCachedCorpusForWatch() {
        guard let origin = resultsLocation?.coordinate else { return }
        onCachedCorpusChange?(cachedSpots, sources, origin)
    }

    func setFilters(_ updated: NearbyFilters) {
        guard updated != filters else { return }
        filters = updated
        if let origin = resultsLocation {
            results = NearbySearch.rank(cachedSpots, from: origin.coordinate, filters: filters, at: Date())
        }
        updateRoutes()
        updateClockTask()
    }

    func refreshTimeDependentResults(at date: Date) {
        guard let origin = resultsLocation else { return }
        let oldIDs = results.map(\.spot.id)
        results = NearbySearch.rank(cachedSpots, from: origin.coordinate, filters: filters, at: date)
        if results.map(\.spot.id) != oldIDs { updateRoutes() }
    }

    func searchDestination(_ text: String) {
        searchGeneration += 1
        let requestGeneration = searchGeneration
        searchTask?.cancel()
        destinationMatches = []
        destinationSearchFailed = false
        let query = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty, let destinationSearch else {
            searchingDestination = false
            return
        }
        searchingDestination = true
        searchTask = Task { [weak self] in
            guard let self else { return }
            do {
                let matches = try await destinationSearch.search(query, near: displayLocation?.coordinate)
                guard requestGeneration == searchGeneration, !Task.isCancelled else { return }
                destinationMatches = matches
            } catch {
                guard requestGeneration == searchGeneration, !Task.isCancelled else { return }
                destinationSearchFailed = true
            }
            searchingDestination = false
        }
    }

    func selectDestination(_ selected: PlaceDestination?) {
        searchGeneration += 1
        searchTask?.cancel()
        destinationMatches = []
        searchingDestination = false
        destinationSearchFailed = false
        destination = selected
        updateRoutes()
    }

    init(
        location: any LocationProviding,
        repository: (any CachedSpotRepository)?,
        refresher: (any NearbyTileRefreshing)?,
        destinationSearch: (any DestinationSearching)? = nil,
        walkingRouter: (any WalkingRouting)? = nil
    ) {
        self.location = location
        self.repository = repository
        self.refresher = refresher
        self.destinationSearch = destinationSearch
        self.walkingRouter = walkingRouter
        locationState = location.state
        if case .usable(let deviceLocation) = locationState {
            lastUsableLocation = deviceLocation
        }
        location.onStateChange = { [weak self] state in
            self?.receive(state)
        }
        if case .usable(let deviceLocation) = locationState {
            load(for: deviceLocation)
        }
    }

    func start() {
        if case .notDetermined = locationState { return }
        location.refresh()
    }

    func refresh() {
        location.refresh()
    }

    private func receive(_ state: NearbyLocationState) {
        locationState = state
        searchGeneration += 1
        searchTask?.cancel()
        destinationMatches = []
        searchingDestination = false
        invalidateRoutes()
        if case .usable(let deviceLocation) = state {
            lastUsableLocation = deviceLocation
            load(for: deviceLocation)
        } else if case .locating = state, lastUsableLocation != nil {
            generation += 1
            loadTask?.cancel()
            dataState = .waitingForLocation
        } else {
            generation += 1
            loadTask?.cancel()
            results = []
            cachedSpots = []
            resultsLocation = nil
            sources = []
            activeTileIDs = []
            lastUsableLocation = nil
            dataState = .waitingForLocation
        }
    }

    private func load(for deviceLocation: DeviceLocation) {
        generation += 1
        let currentGeneration = generation
        loadTask?.cancel()

        guard let repository else {
            results = []
            resultsLocation = nil
            sources = []
            activeTileIDs = []
            dataState = .cacheUnavailable
            return
        }
        guard let currentTile = try? SlippyTile.forCoordinate(
            latitude: deviceLocation.coordinate.latitude,
            longitude: deviceLocation.coordinate.longitude,
            zoom: SlippyTile.dataZoom
        ) else {
            results = []
            resultsLocation = nil
            sources = []
            activeTileIDs = []
            dataState = .cacheUnavailable
            return
        }

        let tiles = currentTile.neighborhood3x3()
        let tileIDs = Set(tiles.map(\.id))
        if tileIDs != activeTileIDs {
            results = []
            cachedSpots = []
            resultsLocation = nil
            sources = []
        }
        activeTileIDs = tileIDs
        dataState = .readingCache
        loadTask = Task { [weak self] in
            guard let self else { return }
            var cachedByTile: [String: [Spot]] = [:]
            var sourcesByTile: [String: [SpotSource]] = [:]
            var cacheReadFailed = false
            for tile in tiles {
                do {
                    cachedByTile[tile.id] = try await repository.spots(inTile: tile.id)
                    sourcesByTile[tile.id] = try await repository.sources(inTile: tile.id)
                } catch {
                    cacheReadFailed = true
                }
                guard currentGeneration == generation else { return }
            }
            publish(cachedByTile, sourcesByTile: sourcesByTile, from: deviceLocation, generation: currentGeneration)

            guard let refresher else {
                dataState = cacheReadFailed ? .refreshFailed : .cacheOnly
                return
            }
            dataState = .refreshing
            let refreshFailed = await withTaskGroup(of: Bool.self, returning: Bool.self) { group in
                for tile in tiles {
                    group.addTask {
                        do {
                            try await refresher.refresh(tile)
                            return false
                        } catch {
                            return true
                        }
                    }
                }
                var failed = false
                for await tileFailed in group { failed = failed || tileFailed }
                return failed
            }
            guard currentGeneration == generation else { return }

            for tile in tiles {
                do {
                    cachedByTile[tile.id] = try await repository.spots(inTile: tile.id)
                    sourcesByTile[tile.id] = try await repository.sources(inTile: tile.id)
                } catch {
                    cacheReadFailed = true
                }
                guard currentGeneration == generation else { return }
            }
            publish(cachedByTile, sourcesByTile: sourcesByTile, from: deviceLocation, generation: currentGeneration)
            dataState = (refreshFailed || cacheReadFailed) ? .refreshFailed : .refreshed
        }
    }

    private func publish(
        _ cachedByTile: [String: [Spot]],
        sourcesByTile: [String: [SpotSource]],
        from deviceLocation: DeviceLocation,
        generation currentGeneration: Int
    ) {
        guard currentGeneration == generation else { return }
        var seenIDs = Set<String>()
        let spots = cachedByTile.keys.sorted().flatMap { cachedByTile[$0] ?? [] }
            .filter { seenIDs.insert($0.id).inserted }
        cachedSpots = spots
        results = NearbySearch.rank(spots, from: deviceLocation.coordinate, filters: filters, at: Date())
        resultsLocation = deviceLocation
        var seenSources = Set<SpotSource>()
        sources = sourcesByTile.keys.sorted().flatMap { sourcesByTile[$0] ?? [] }
            .filter { seenSources.insert($0).inserted }
            .sorted {
                ($0.displayName, $0.id, $0.attributionText ?? "") <
                ($1.displayName, $1.id, $1.attributionText ?? "")
            }
        onCachedCorpusChange?(spots, sources, deviceLocation.coordinate)
        updateRoutes()
    }

    private func invalidateRoutes() {
        routeGeneration += 1
        routeTask?.cancel()
        walkingRouter?.cancel()
        routeResults = RouteDetourRanker.rank(results, detours: [:])
        routeState = destination == nil ? .idle : .unavailable
    }

    private func updateRoutes() {
        invalidateRoutes()
        guard let destination, let origin = resultsLocation?.coordinate,
              origin == displayLocation?.coordinate,
              resultsLocation?.isLastKnown == false,
              displayLocation?.isLastKnown == false,
              let walkingRouter, !results.isEmpty else { return }
        let currentGeneration = routeGeneration
        let candidates = RouteDetourRanker.candidates(results, from: origin, to: destination.coordinate)
        let key = RouteRequestKey(
            origin: origin, destination: destination.coordinate,
            candidates: candidates.map {
                RouteCandidateKey(id: $0.spot.id, coordinate: SpotCoordinate(
                    latitude: $0.spot.latitude, longitude: $0.spot.longitude
                ))
            }
        )
        if key == lastRouteKey, let lastRouteComputedAt,
           Date().timeIntervalSince(lastRouteComputedAt) < 300 {
            routeResults = RouteDetourRanker.rank(results, detours: lastDetours)
            routeState = .ready
            return
        }
        routeState = .loading
        routeTask = Task { [weak self] in
            guard let self else { return }
            do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
            guard currentGeneration == routeGeneration else { return }
            let direct: WalkingRoute
            do {
                direct = try await walkingRouter.route(from: origin, to: destination.coordinate)
            } catch {
                guard currentGeneration == routeGeneration else { return }
                routeState = .unavailable
                return
            }
            guard currentGeneration == routeGeneration, !Task.isCancelled else { return }
            var detours: [String: TimeInterval] = [:]
            for candidate in candidates {
                let spotCoordinate = SpotCoordinate(
                    latitude: candidate.spot.latitude, longitude: candidate.spot.longitude
                )
                do {
                    let first = try await walkingRouter.route(from: origin, to: spotCoordinate)
                    guard currentGeneration == routeGeneration, !Task.isCancelled else { return }
                    let second = try await walkingRouter.route(from: spotCoordinate, to: destination.coordinate)
                    guard currentGeneration == routeGeneration, !Task.isCancelled else { return }
                    detours[candidate.spot.id] = RouteDetourRanker.detourSeconds(
                        direct: direct.travelTime, viaSpot: first.travelTime, onward: second.travelTime
                    )
                } catch {
                    guard currentGeneration == routeGeneration, !Task.isCancelled else { return }
                }
            }
            guard currentGeneration == routeGeneration, !Task.isCancelled else { return }
            routeResults = RouteDetourRanker.rank(results, detours: detours)
            routeState = detours.isEmpty ? .unavailable : .ready
            if !detours.isEmpty {
                lastRouteKey = key
                lastDetours = detours
                lastRouteComputedAt = Date()
            }
        }
    }

    private func updateClockTask() {
        clockTask?.cancel()
        guard filters.openNowOnly else { return }
        clockTask = Task { [weak self] in
            while !Task.isCancelled {
                let now = Date().timeIntervalSince1970
                let secondsToNextMinute = 60 - now.truncatingRemainder(dividingBy: 60) + 0.05
                do { try await Task.sleep(for: .seconds(secondsToNextMinute)) } catch { return }
                guard let self, !Task.isCancelled else { return }
                self.refreshTimeDependentResults(at: Date())
            }
        }
    }
}

private struct RouteCandidateKey: Equatable {
    let id: String
    let coordinate: SpotCoordinate
}

private struct RouteRequestKey: Equatable {
    let origin: SpotCoordinate
    let destination: SpotCoordinate
    let candidates: [RouteCandidateKey]
}
