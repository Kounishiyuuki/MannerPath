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

    private(set) var locationState: NearbyLocationState
    private(set) var dataState: NearbyDataState = .waitingForLocation
    private(set) var results: [NearbyResult] = []

    init(
        location: any LocationProviding,
        repository: (any CachedSpotRepository)?,
        refresher: (any NearbyTileRefreshing)?
    ) {
        self.location = location
        self.repository = repository
        self.refresher = refresher
        locationState = location.state
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
            load(for: deviceLocation)
        } else {
            generation += 1
            loadTask?.cancel()
            results = []
            dataState = .waitingForLocation
        }
    }

    private func load(for deviceLocation: DeviceLocation) {
        generation += 1
        let currentGeneration = generation
        loadTask?.cancel()
        results = []

        guard let repository else {
            dataState = .cacheUnavailable
            return
        }
        guard let currentTile = try? SlippyTile.forCoordinate(
            latitude: deviceLocation.coordinate.latitude,
            longitude: deviceLocation.coordinate.longitude,
            zoom: SlippyTile.dataZoom
        ) else {
            dataState = .cacheUnavailable
            return
        }

        let tiles = currentTile.neighborhood3x3()
        dataState = .readingCache
        loadTask = Task { [weak self] in
            guard let self else { return }
            var cachedByTile: [String: [Spot]] = [:]
            var cacheReadFailed = false
            for tile in tiles {
                do {
                    cachedByTile[tile.id] = try await repository.spots(inTile: tile.id)
                } catch {
                    cacheReadFailed = true
                }
                guard currentGeneration == generation else { return }
            }
            publish(cachedByTile, from: deviceLocation, generation: currentGeneration)

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
                } catch {
                    cacheReadFailed = true
                }
                guard currentGeneration == generation else { return }
            }
            publish(cachedByTile, from: deviceLocation, generation: currentGeneration)
            dataState = (refreshFailed || cacheReadFailed) ? .refreshFailed : .refreshed
        }
    }

    private func publish(_ cachedByTile: [String: [Spot]], from deviceLocation: DeviceLocation, generation currentGeneration: Int) {
        guard currentGeneration == generation else { return }
        var seenIDs = Set<String>()
        let spots = cachedByTile.keys.sorted().flatMap { cachedByTile[$0] ?? [] }
            .filter { seenIDs.insert($0.id).inserted }
        results = NearbySearch.rank(spots, from: deviceLocation.coordinate, at: Date())
    }
}
