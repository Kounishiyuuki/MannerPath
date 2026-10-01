import Foundation

// ADR-0013 "is it one of these?": listed places close to a pin the user is about to add. Computed on the device from
// places already loaded; nothing is sent, and nothing is merged — a nearby place may be a different one.
enum DuplicateCandidates {
    /// Same radius as the reviewer's duplicate view (services/api/src/pipeline/community-evidence.ts).
    static let radiusMeters = 50.0

    static func near(_ pin: ReportCoordinate, in spots: [Spot], limit: Int = 3) -> [(spot: Spot, distanceMeters: Double)] {
        spots.map { spot in
            (spot: spot, distanceMeters: NearbySearch.straightLineDistance(
                from: SpotCoordinate(latitude: pin.latitude, longitude: pin.longitude),
                to: SpotCoordinate(latitude: spot.latitude, longitude: spot.longitude)))
        }
        .filter { $0.distanceMeters <= radiusMeters }
        .sorted { $0.distanceMeters < $1.distanceMeters }
        .prefix(limit)
        .map { $0 }
    }
}
