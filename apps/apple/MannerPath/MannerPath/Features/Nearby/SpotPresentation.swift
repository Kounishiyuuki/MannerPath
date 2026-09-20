import Foundation

enum SpotPresentation {
    static func name(_ spot: Spot) -> String { spot.name ?? type(spot.spotType) }

    static func type(_ value: SpotType) -> String {
        switch value {
        case .designatedOutdoorArea: "Designated outdoor area"
        case .publicSmokingRoom: "Public smoking room"
        case .facilitySmokingRoom: "Facility smoking room"
        case .ashtray: "Ashtray location"
        case .smokingPermittedVenue: "Smoking-permitted venue"
        case .unknown: "Unknown physical type"
        case .unsupported: "Unsupported physical type"
        }
    }

    static func access(_ value: AccessType) -> String {
        switch value {
        case .public: "Public"
        case .customerOnly: "Customers only"
        case .facilityOnly: "Facility access only"
        case .unknown: "Unknown"
        }
    }

    static func environment(_ value: SpotEnvironment) -> String {
        switch value {
        case .indoor: "Indoor"
        case .outdoor: "Outdoor"
        case .covered: "Covered"
        case .unknown: "Unknown"
        }
    }

    static func tobacco(_ value: TriState) -> String {
        switch value {
        case .yes: "Confirmed"
        case .no: "Confirmed not supported"
        case .unknown: "Unknown"
        }
    }

    static func hoursState(_ hours: SpotOpeningHours?) -> String {
        guard let hours else { return "Unknown" }
        switch hours.status {
        case .none: return "Unknown"
        case .parsed: return hours.parsed == nil ? "Schedule unavailable" : "Reported schedule"
        case .unparsed: return "Unconfirmed; raw text only"
        case .unsupported: return "Unsupported hours format"
        }
    }

    static func evidence(_ value: String?) -> String {
        guard let value, !value.isEmpty else { return "Unknown" }
        return value == "officialListing" ? "Official listing" : value
    }

    static func verificationDate(_ value: Date?) -> String {
        guard let value else { return "Unknown" }
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter.string(from: value)
    }

    static func freshness(_ result: NearbyResult) -> String {
        guard let age = result.verificationAge else { return "Unknown" }
        let days = Int(age / 86_400)
        if days == 0 { return "Verified less than a day ago" }
        return "Verified \(days) day\(days == 1 ? "" : "s") ago"
    }

    static func distance(_ meters: Double) -> String {
        if meters < 1 { return "<1 m" }
        if meters < 1_000 { return "\(Int(meters.rounded())) m" }
        return "\((meters / 1_000).formatted(.number.precision(.fractionLength(1)))) km"
    }

    static func bearing(_ result: NearbyResult, accuracyMeters: Double) -> String {
        guard result.distanceMeters > max(accuracyMeters, 1) else {
            return "Uncertain within location accuracy"
        }
        return "\(Int(result.bearingDegrees.rounded()))° clockwise from north"
    }

    static func sourceNames(_ spot: Spot) -> String {
        let names = spot.verification.sourceDisplayNames
        return names.isEmpty ? "Unknown" : names.joined(separator: ", ")
    }
}
