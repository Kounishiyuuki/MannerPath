import Foundation
import Testing
@testable import MannerPath

@MainActor
struct NearbyLocationModelTests {
    private let fixtureCoordinate = SpotCoordinate(latitude: 35.681236, longitude: 139.767125)

    @Test func asksForLocationOnlyAfterExplicitRefreshWhenPermissionIsUndetermined() {
        let location = FakeLocationProvider(state: .notDetermined)
        let model = NearbyModel(location: location, spots: [])

        model.start()
        #expect(location.refreshCount == 0)
        #expect(model.results.isEmpty)

        model.refresh()
        #expect(location.refreshCount == 1)

        location.send(.locating)
        model.start()
        #expect(location.refreshCount == 2)
    }

    @Test func deniedOrUnavailableLocationClearsNearbyResults() throws {
        let location = FakeLocationProvider(state: .locating)
        let model = NearbyModel(location: location, spots: try FixtureSpotRepository().allSpots())
        #expect(model.results.isEmpty)

        location.send(.usable(deviceLocation()))
        #expect(model.results.count == 1)

        // A denied authorization status can also mean device Location Services are off.
        location.send(.denied)
        guard case .denied = model.locationState else {
            Issue.record("Expected denied state")
            return
        }
        #expect(model.results.isEmpty)

        location.send(.unavailable)
        guard case .unavailable = model.locationState else {
            Issue.record("Expected unavailable state")
            return
        }
        #expect(model.results.isEmpty)
    }

    @Test func usableLocationRanksOnlyPublishedFixtureAndUpdatesDistance() throws {
        let location = FakeLocationProvider(state: .usable(deviceLocation()))
        let model = NearbyModel(location: location, spots: try FixtureSpotRepository().allSpots())

        let nearby = try #require(model.results.first)
        #expect(model.fixtureAvailable)
        #expect(model.results.map(\.spot.id) == ["fixture-designated-area"])
        #expect(nearby.distanceMeters < 1)
        #expect(nearby.spot.supportsHeated == .unknown)
        #expect(nearby.spot.verification.evidenceQuality == nil)

        location.send(.usable(deviceLocation(at: SpotCoordinate(latitude: 35.682236, longitude: 139.767125))))
        let moved = try #require(model.results.first)
        #expect(moved.spot.id == nearby.spot.id)
        #expect(moved.distanceMeters > 100)
        #expect(moved.distanceMeters < 120)
    }

    @Test func retainsApproximateAndLastKnownLocationStateWithoutInventingResults() {
        let device = deviceLocation(isApproximate: true, isLastKnown: true)
        let location = FakeLocationProvider(state: .usable(device))
        let model = NearbyModel(location: location, spots: nil)

        #expect(!model.fixtureAvailable)
        #expect(model.results.isEmpty)
        guard case .usable(let observed) = model.locationState else {
            Issue.record("Expected usable location")
            return
        }
        #expect(observed.isApproximate)
        #expect(observed.isLastKnown)
        #expect(observed.timestamp == device.timestamp)
    }

    private func deviceLocation(
        at coordinate: SpotCoordinate? = nil,
        isApproximate: Bool = false,
        isLastKnown: Bool = false
    ) -> DeviceLocation {
        DeviceLocation(
            coordinate: coordinate ?? fixtureCoordinate,
            timestamp: Date(timeIntervalSince1970: 1_789_920_000),
            horizontalAccuracyMeters: 20,
            isApproximate: isApproximate,
            isLastKnown: isLastKnown
        )
    }
}

@MainActor
private final class FakeLocationProvider: LocationProviding {
    private(set) var state: NearbyLocationState
    var onStateChange: (@MainActor (NearbyLocationState) -> Void)?
    private(set) var refreshCount = 0

    init(state: NearbyLocationState) {
        self.state = state
    }

    func refresh() {
        refreshCount += 1
    }

    func send(_ state: NearbyLocationState) {
        self.state = state
        onStateChange?(state)
    }
}
