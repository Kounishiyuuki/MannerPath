import Foundation
import WidgetKit

@MainActor
enum PhoneGlancePublisher {
    static func publish(spots: [Spot], near location: DeviceLocation, at now: Date = Date()) {
        let nearest = NearbySearch.rank(spots, from: location.coordinate, at: now).first
        let glance = NearbyGlance(version: 1, computedAt: now, locationObservedAt: location.timestamp,
                                  locationIsLastKnown: location.isLastKnown,
                                  spotID: nearest?.spot.id,
                                  name: nearest.map { $0.spot.name ?? "Nearby place" },
                                  distanceMeters: nearest?.distanceMeters,
                                  lastVerifiedAt: nearest?.spot.lastVerifiedAt)
        guard let directory = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: NearbyGlanceFile.group),
              (try? NearbyGlanceFile.write(glance, to: directory)) != nil else { return }
        WidgetCenter.shared.reloadTimelines(ofKind: "NearbyGlance")
    }
}
