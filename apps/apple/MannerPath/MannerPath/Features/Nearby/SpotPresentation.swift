import Foundation

enum SpotPresentation {
    static func name(_ spot: Spot) -> String { spot.name ?? type(spot.spotType) }

    static func type(_ value: SpotType) -> String {
        switch value {
        case .designatedOutdoorArea: String(localized: "Designated outdoor area")
        case .publicSmokingRoom: String(localized: "Public smoking room")
        case .facilitySmokingRoom: String(localized: "Facility smoking room")
        case .ashtray: String(localized: "Ashtray location")
        case .smokingPermittedVenue: String(localized: "Smoking-permitted venue")
        case .unknown: String(localized: "Unknown physical type")
        case .unsupported: String(localized: "Unsupported physical type")
        }
    }

    static func access(_ value: AccessType) -> String {
        switch value {
        case .public: String(localized: "Public")
        case .customerOnly: String(localized: "Customers only")
        case .facilityOnly: String(localized: "Facility access only")
        case .unknown: String(localized: "Unknown")
        }
    }

    static func environment(_ value: SpotEnvironment) -> String {
        switch value {
        case .indoor: String(localized: "Indoor")
        case .outdoor: String(localized: "Outdoor")
        case .covered: String(localized: "Covered")
        case .unknown: String(localized: "Unknown")
        }
    }

    static func tobacco(_ value: TriState) -> String {
        switch value {
        case .yes: String(localized: "Confirmed")
        case .no: String(localized: "Confirmed not supported")
        case .unknown: String(localized: "Unknown")
        }
    }

    static func hoursState(_ hours: SpotOpeningHours?) -> String {
        guard let hours else { return String(localized: "Unknown") }
        switch hours.status {
        case .none: return String(localized: "Unknown")
        case .parsed: return hours.parsed == nil ? String(localized: "Schedule unavailable") : String(localized: "Reported schedule")
        case .unparsed: return String(localized: "Unconfirmed source text")
        case .unsupported: return String(localized: "Unsupported hours format")
        }
    }

    static func evidence(_ value: String?) -> String {
        guard let value, !value.isEmpty else { return String(localized: "Unknown") }
        return value == "officialListing" ? String(localized: "Official listing") : String(localized: "Evidence confidence unknown")
    }

    static func verificationDate(_ value: Date?) -> String {
        guard let value else { return String(localized: "Unknown") }
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter.string(from: value)
    }

    static func freshness(_ result: NearbyResult) -> String {
        guard let age = result.verificationAge else { return String(localized: "Unknown") }
        let days = Int(age / 86_400)
        if days == 0 { return String(localized: "Verified less than a day ago") }
        return String(localized: "Verified \(days) days ago")
    }

    static func distance(_ meters: Double) -> String {
        if meters < 1 { return String(localized: "Less than 1 m") }
        if meters < 1_000 { return String(localized: "\(Int(meters.rounded())) m") }
        return String(localized: "\((meters / 1_000).formatted(.number.precision(.fractionLength(1)))) km")
    }

    static func bearing(_ result: NearbyResult, accuracyMeters: Double) -> String {
        guard result.distanceMeters > max(accuracyMeters, 1) else {
            return String(localized: "Uncertain within location accuracy")
        }
        return String(localized: "\(Int(result.bearingDegrees.rounded()))° clockwise from north")
    }

    static func sourceNames(_ spot: Spot) -> String {
        let names = spot.verification.sourceDisplayNames
        return names.isEmpty ? String(localized: "Unknown") : names.joined(separator: ", ")
    }
}
