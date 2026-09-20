import Foundation

nonisolated struct SpotCoordinate: Equatable, Sendable {
    let latitude: Double
    let longitude: Double

    var isValid: Bool {
        latitude.isFinite && longitude.isFinite &&
        (-90...90).contains(latitude) && (-180...180).contains(longitude)
    }
}

enum TobaccoType: Sendable, Hashable {
    case paper, heated
}

struct NearbyFilters: Sendable, Equatable {
    var spotTypes: Set<SpotType>? = nil
    var tobaccoType: TobaccoType? = nil
    var requireConfirmedTobaccoSupport = false
    var publicAccessOnly = false
    var requireConfirmedPublicAccess = false
    var accessTypes: Set<AccessType>? = nil
    var environments: Set<SpotEnvironment>? = nil
    var openNowOnly = false
    var officialEvidenceOnly = false
    var maximumDistanceMeters: Double? = nil
    var verifiedWithin: TimeInterval? = nil
}

struct NearbyResult: Sendable {
    let spot: Spot
    let distanceMeters: Double
    // Clockwise degrees from north; 0 at the same coordinates.
    let bearingDegrees: Double
    // nil means verification observation time is unknown.
    let verificationAge: TimeInterval?
}

enum NearbySearch {
    static let algorithmVersion = 1

    static func rank(
        _ spots: [Spot],
        from origin: SpotCoordinate,
        filters: NearbyFilters = NearbyFilters(),
        at date: Date
    ) -> [NearbyResult] {
        guard origin.isValid else { return [] }

        return spots.compactMap { spot -> NearbyResult? in
            guard spot.lifecycle == .active,
                  spot.mergedInto == nil,
                  spot.verification.acceptedExistenceEvidence == .yes,
                  spot.spotType != .unsupported else { return nil }

            let destination = SpotCoordinate(latitude: spot.latitude, longitude: spot.longitude)
            guard destination.isValid else { return nil }
            if let spotTypes = filters.spotTypes, !spotTypes.contains(spot.spotType) { return nil }

            if let tobaccoType = filters.tobaccoType {
                let support = tobaccoType == .paper ? spot.supportsPaper : spot.supportsHeated
                if support == .no || (filters.requireConfirmedTobaccoSupport && support != .yes) {
                    return nil
                }
            }
            if filters.publicAccessOnly || filters.requireConfirmedPublicAccess {
                if spot.accessType == .customerOnly || spot.accessType == .facilityOnly ||
                    (filters.requireConfirmedPublicAccess && spot.accessType != .public) {
                    return nil
                }
            }
            if let accessTypes = filters.accessTypes, !accessTypes.contains(spot.accessType) { return nil }
            if let environments = filters.environments, !environments.contains(spot.environment) { return nil }
            if filters.openNowOnly && openNow(spot.openingHours, at: date) != .yes { return nil }
            if filters.officialEvidenceOnly &&
                (spot.verification.evidenceQualityVersion != "evidence-quality.v1" ||
                 spot.verification.evidenceQuality != "officialListing") { return nil }

            let distance = straightLineDistance(from: origin, to: destination)
            if let maximum = filters.maximumDistanceMeters, distance > maximum { return nil }
            let age = spot.verification.age(at: date, lastVerifiedAt: spot.lastVerifiedAt)
            if let verifiedWithin = filters.verifiedWithin {
                guard let age, age <= verifiedWithin else { return nil }
            }

            return NearbyResult(
                spot: spot,
                distanceMeters: distance,
                bearingDegrees: bearing(from: origin, to: destination),
                verificationAge: age
            )
        }
        .sorted {
            if $0.distanceMeters != $1.distanceMeters {
                return $0.distanceMeters < $1.distanceMeters
            }
            return $0.spot.id < $1.spot.id
        }
    }

    static func straightLineDistance(from start: SpotCoordinate, to end: SpotCoordinate) -> Double {
        let latitudeDelta = (end.latitude - start.latitude) * .pi / 180
        let longitudeDelta = (end.longitude - start.longitude) * .pi / 180
        let startLatitude = start.latitude * .pi / 180
        let endLatitude = end.latitude * .pi / 180
        let haversine = pow(sin(latitudeDelta / 2), 2) +
            cos(startLatitude) * cos(endLatitude) * pow(sin(longitudeDelta / 2), 2)
        return 2 * 6_371_000 * asin(min(1, sqrt(haversine)))
    }

    static func openNow(_ hours: SpotOpeningHours?, at date: Date) -> TriState {
        guard let hours, hours.status == .parsed, let parsed = hours.parsed,
              parsed.version == 1, TimeZone(identifier: hours.timeZone) != nil else { return .unknown }
        if parsed.kind == .allDay { return .yes }
        guard parsed.kind == .daily,
              let opens = minuteOfDay(parsed.opens), let closes = minuteOfDay(parsed.closes),
              opens < 1_440, opens != closes,
              let zone = TimeZone(identifier: hours.timeZone) else { return .unknown }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let components = calendar.dateComponents([.hour, .minute], from: date)
        guard let hour = components.hour, let minute = components.minute else { return .unknown }
        let current = hour * 60 + minute
        return (opens < closes ? (opens <= current && current < closes) :
                (current >= opens || current < closes)) ? .yes : .no
    }

    private static func minuteOfDay(_ value: String?) -> Int? {
        guard let value else { return nil }
        let parts = value.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2, parts[0].count == 2, parts[1].count == 2,
              let hour = Int(parts[0]), let minute = Int(parts[1]),
              (0...24).contains(hour), (0...59).contains(minute),
              hour != 24 || minute == 0 else { return nil }
        return hour * 60 + minute
    }

    private static func bearing(from start: SpotCoordinate, to end: SpotCoordinate) -> Double {
        let startLatitude = start.latitude * .pi / 180
        let endLatitude = end.latitude * .pi / 180
        let longitudeDelta = (end.longitude - start.longitude) * .pi / 180
        let y = sin(longitudeDelta) * cos(endLatitude)
        let x = cos(startLatitude) * sin(endLatitude) -
            sin(startLatitude) * cos(endLatitude) * cos(longitudeDelta)
        let degrees = atan2(y, x) * 180 / .pi
        return (degrees + 360).truncatingRemainder(dividingBy: 360)
    }
}
