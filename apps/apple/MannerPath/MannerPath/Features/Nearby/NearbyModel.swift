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

@Observable
@MainActor
final class NearbyModel {
    private let location: any LocationProviding
    private let repository: (any CachedSpotRepository)?
    private let refresher: (any NearbyTileRefreshing)?
    private var loadTask: Task<Void, Never>?
    private var generation = 0
    private var activeTileIDs: Set<String> = []

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

    init(
        location: any LocationProviding,
        repository: (any CachedSpotRepository)?,
        refresher: (any NearbyTileRefreshing)?
    ) {
        self.location = location
        self.repository = repository
        self.refresher = refresher
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
        results = NearbySearch.rank(spots, from: deviceLocation.coordinate, at: Date())
        resultsLocation = deviceLocation
        var seenSources = Set<SpotSource>()
        sources = sourcesByTile.keys.sorted().flatMap { sourcesByTile[$0] ?? [] }
            .filter { seenSources.insert($0).inserted }
            .sorted {
                ($0.displayName, $0.id, $0.attributionText ?? "") <
                ($1.displayName, $1.id, $1.attributionText ?? "")
            }
    }
}
