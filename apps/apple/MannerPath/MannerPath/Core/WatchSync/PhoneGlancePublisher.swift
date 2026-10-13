import Foundation
import WidgetKit

@MainActor
enum PhoneGlancePublisher {
    static func publish(spots: [Spot], near location: DeviceLocation, at now: Date = Date()) {
        let glance = build(spots: spots, near: location, at: now)
        guard let directory = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: NearbyGlanceFile.group),
              (try? NearbyGlanceFile.write(glance, to: directory)) != nil else { return }
        WidgetCenter.shared.reloadTimelines(ofKind: "NearbyGlance")
    }

    /// The same normalized snapshot is used by the App Group writer and simulator integration tests.
    static func build(spots: [Spot], near location: DeviceLocation, at now: Date) -> NearbyGlance {
        let nearest = NearbySearch.rank(spots, from: location.coordinate, at: now).first
        return NearbyGlance(version: 1, computedAt: now, locationObservedAt: location.timestamp,
                                  locationIsLastKnown: location.isLastKnown,
                                  spotID: nearest?.spot.id,
                                  name: nearest.map { $0.spot.name ?? "Nearby place" },
                                  distanceMeters: nearest?.distanceMeters,
                                  lastVerifiedAt: nearest?.spot.lastVerifiedAt,
                                  locationIsApproximate: nearest.map { $0.spot.verification.isAreaApproximate },
                                  existence: nearest?.spot.verification.existenceTier.rawValue,
                                  locationPrecision: nearest?.spot.verification.locationPrecision?.rawValue,
                                  locationAreaScope: nearest?.spot.verification.isAreaApproximate == true
                                      ? nearest?.spot.verification.locationArea?.scope : nil)
    }
}
