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

enum NearbyArea {
    case device(DeviceLocation)
    case destination(PlaceDestination)

    var coordinate: SpotCoordinate {
        switch self {
        case .device(let location): location.coordinate
        case .destination(let place): place.coordinate
        }
    }

    var deviceLocation: DeviceLocation? {
        if case .device(let location) = self { return location }
        return nil
    }

    var isDestination: Bool {
        if case .destination = self { return true }
        return false
    }
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
    /// The zoom tiles are read and synced at: the cache's namespace offline, GET /v1/config online (ADR-0015).
    private var dataZoom = SlippyTile.defaultDataZoom
    private var cachedSpots: [Spot] = []
    private var lastRouteKey: RouteRequestKey?
    private var lastDetours: [String: TimeInterval] = [:]
    private var lastRouteComputedAt: Date?
    private var deviceCorpus: (spots: [Spot], sources: [SpotSource], location: DeviceLocation, cacheReadFailed: Bool)?
    var onCachedCorpusChange: (([Spot], [SpotSource], SpotCoordinate) -> Void)?
    var onCachedGlanceChange: (([Spot], DeviceLocation) -> Void)?

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
    private(set) var resultsArea: NearbyArea?
    var resultsLocation: DeviceLocation? { resultsArea?.deviceLocation }
    var browsingCoordinate: SpotCoordinate? { destination?.coordinate ?? displayLocation?.coordinate }
    var routeUnavailableDescription: String {
        displayLocation == nil || displayLocation?.isLastKnown == true
            ? String(localized: "A current location is needed for walking detours. Showing straight-line distance and bearing.")
            : String(localized: "Walking routes unavailable. Showing saved places by straight-line distance and bearing.")
    }
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

    // Widget links use the unfiltered corpus, while ordinary Nearby results keep user filters.
    func cachedResult(id: String) -> NearbyResult? {
        guard let origin = resultsArea?.coordinate else { return nil }
        return NearbySearch.rank(cachedSpots, from: origin, at: Date()).first { $0.spot.id == id }
    }

    var hasUnfilteredResults: Bool {
        guard let origin = resultsArea?.coordinate else { return false }
        return !NearbySearch.rank(cachedSpots, from: origin, at: Date()).isEmpty
    }

    func publishCachedCorpusForWatch() {
        guard let deviceCorpus else { return }
        onCachedCorpusChange?(deviceCorpus.spots, deviceCorpus.sources, deviceCorpus.location.coordinate)
        if !deviceCorpus.cacheReadFailed { onCachedGlanceChange?(deviceCorpus.spots, deviceCorpus.location) }
    }

    func setFilters(_ updated: NearbyFilters) {
        guard updated != filters else { return }
        filters = updated
        if let origin = resultsArea {
            results = NearbySearch.rank(cachedSpots, from: origin.coordinate, filters: filters, at: Date())
        }
        updateRoutes()
        updateClockTask()
    }

    func refreshTimeDependentResults(at date: Date) {
        guard let origin = resultsArea else { return }
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
        if let selected {
            load(for: .destination(selected))
        } else if let location = displayLocation {
            load(for: .device(location))
        } else {
            generation += 1
            loadTask?.cancel()
            enter([])
            dataState = .waitingForLocation
        }
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
            load(for: .device(deviceLocation))
        }
    }

    func start() {
        if case .notDetermined = locationState { return }
        location.refresh()
    }

    func refresh() {
        if let destination { load(for: .destination(destination)) }
        else { refreshDeviceLocation() }
    }

    func refreshDeviceLocation() {
        location.refresh()
    }

    private func receive(_ state: NearbyLocationState) {
        locationState = state
        if destination != nil {
            if case .usable(let deviceLocation) = state { lastUsableLocation = deviceLocation }
            else if case .locating = state {} else {
                lastUsableLocation = nil
                deviceCorpus = nil
            }
            updateRoutes()
            return
        }
        searchGeneration += 1
        searchTask?.cancel()
        destinationMatches = []
        searchingDestination = false
        invalidateRoutes()
        if case .usable(let deviceLocation) = state {
            lastUsableLocation = deviceLocation
            load(for: .device(deviceLocation))
        } else if case .locating = state, lastUsableLocation != nil {
            generation += 1
            loadTask?.cancel()
            dataState = .waitingForLocation
        } else {
            generation += 1
            loadTask?.cancel()
            results = []
            cachedSpots = []
            resultsArea = nil
            sources = []
            activeTileIDs = []
            lastUsableLocation = nil
            deviceCorpus = nil
            dataState = .waitingForLocation
        }
    }

    private func load(for area: NearbyArea) {
        generation += 1
        let currentGeneration = generation
        loadTask?.cancel()

        guard let repository else {
            results = []
            resultsArea = nil
            sources = []
            activeTileIDs = []
            dataState = .cacheUnavailable
            return
        }
        guard let initialTiles = Self.neighborhood(of: area.coordinate, zoom: dataZoom) else {
            results = []
            resultsArea = nil
            sources = []
            activeTileIDs = []
            dataState = .cacheUnavailable
            return
        }

        enter(initialTiles)
        if resultsArea != nil, area.isDestination || resultsArea?.isDestination == true {
            resultsArea = area
            results = NearbySearch.rank(cachedSpots, from: area.coordinate, filters: filters, at: Date())
        }
        dataState = .readingCache
        loadTask = Task { [weak self] in
            guard let self else { return }
            var tiles = initialTiles
            // Offline reads follow the cache's own namespace, whatever zoom this model last used.
            if let cachedZoom = try? await repository.dataZoom(), cachedZoom != dataZoom,
               let moved = Self.neighborhood(of: area.coordinate, zoom: cachedZoom) {
                guard currentGeneration == generation else { return }
                dataZoom = cachedZoom
                tiles = moved
                enter(tiles)
            }
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
            publish(cachedByTile, sourcesByTile: sourcesByTile, from: area,
                    cacheReadFailed: cacheReadFailed, generation: currentGeneration)

            guard let refresher else {
                dataState = cacheReadFailed ? .refreshFailed : .cacheOnly
                return
            }
            dataState = .refreshing
            // The server's zoom is the single source of truth. Unreachable or unsupported config fails closed: no tile
            // is synced, and the cached tiles already shown stay as they are.
            let serverZoom: Int
            do {
                serverZoom = try await refresher.prepare()
            } catch {
                guard currentGeneration == generation else { return }
                dataState = .refreshFailed
                return
            }
            guard currentGeneration == generation else { return }
            if serverZoom != dataZoom, let moved = Self.neighborhood(of: area.coordinate, zoom: serverZoom) {
                dataZoom = serverZoom
                tiles = moved
                enter(tiles)
                cachedByTile = [:]
                sourcesByTile = [:]
            }
            let refreshTiles = tiles
            let refreshFailed = await withTaskGroup(of: Bool.self, returning: Bool.self) { group in
                for tile in refreshTiles {
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
            publish(cachedByTile, sourcesByTile: sourcesByTile, from: area,
                    cacheReadFailed: cacheReadFailed, generation: currentGeneration)
            dataState = (refreshFailed || cacheReadFailed) ? .refreshFailed : .refreshed
        }
    }

    private static func neighborhood(of coordinate: SpotCoordinate, zoom: Int) -> [SlippyTile]? {
        (try? SlippyTile.forCoordinate(
            latitude: coordinate.latitude,
            longitude: coordinate.longitude,
            zoom: zoom
        ))?.neighborhood3x3()
    }

    private func enter(_ tiles: [SlippyTile]) {
        let tileIDs = Set(tiles.map(\.id))
        if tileIDs != activeTileIDs {
            results = []
            cachedSpots = []
            resultsArea = nil
            sources = []
        }
        activeTileIDs = tileIDs
    }

    private func publish(
        _ cachedByTile: [String: [Spot]],
        sourcesByTile: [String: [SpotSource]],
        from area: NearbyArea,
        cacheReadFailed: Bool,
        generation currentGeneration: Int
    ) {
        guard currentGeneration == generation else { return }
        var seenIDs = Set<String>()
        let spots = cachedByTile.keys.sorted().flatMap { cachedByTile[$0] ?? [] }
            .filter { seenIDs.insert($0.id).inserted }
        cachedSpots = spots
        results = NearbySearch.rank(spots, from: area.coordinate, filters: filters, at: Date())
        resultsArea = area
        var seenSources = Set<SpotSource>()
        sources = sourcesByTile.keys.sorted().flatMap { sourcesByTile[$0] ?? [] }
            .filter { seenSources.insert($0).inserted }
            .sorted {
                ($0.displayName, $0.id, $0.attributionText ?? "") <
                ($1.displayName, $1.id, $1.attributionText ?? "")
            }
        if let deviceLocation = area.deviceLocation {
            deviceCorpus = (spots, sources, deviceLocation, cacheReadFailed)
            onCachedCorpusChange?(spots, sources, deviceLocation.coordinate)
            if !cacheReadFailed { onCachedGlanceChange?(spots, deviceLocation) }
        }
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
        guard let destination, let origin = displayLocation?.coordinate,
              resultsArea?.coordinate == destination.coordinate,
              displayLocation?.isLastKnown == false,
              RouteDetourRanker.canRequestWalkingDetours(from: origin, to: destination.coordinate),
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
