import Foundation
import Observation

@Observable
@MainActor
final class NearbyModel {
    private let location: any LocationProviding
    private let spots: [Spot]?
    private(set) var locationState: NearbyLocationState

    init(location: any LocationProviding, spots: [Spot]?) {
        self.location = location
        self.spots = spots
        locationState = location.state
        location.onStateChange = { [weak self] state in
            self?.locationState = state
        }
    }

    static func live() -> NearbyModel {
        NearbyModel(
            location: DeviceLocationService(),
            spots: try? FixtureSpotRepository().allSpots()
        )
    }

    func start() {
        if case .notDetermined = locationState { return }
        location.refresh()
    }

    func refresh() {
        location.refresh()
    }

    var fixtureAvailable: Bool { spots != nil }

    var results: [NearbyResult] {
        guard case .usable(let deviceLocation) = locationState, let spots else { return [] }
        return NearbySearch.rank(spots, from: deviceLocation.coordinate, at: Date())
    }
}
