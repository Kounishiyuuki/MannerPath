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

    /// The access condition with its refinement, e.g. ticket holders inside a facility.
    static func access(_ spot: Spot) -> String {
        spot.accessDetail == .ticketedUsersOnly ? String(localized: "Ticket holders only") : access(spot.accessType)
    }

    /// The physical type, refined when the evidence states a subtype.
    static func type(_ spot: Spot) -> String {
        switch spot.spotSubtype {
        case .smokingCorner: String(localized: "Smoking corner")
        case .tobaccoShopSmokingSpace: String(localized: "Tobacco shop smoking space")
        case nil: type(spot.spotType)
        }
    }

    /// Where the place is. nil for an unstated host: nothing is shown rather than "unknown".
    static func host(_ value: HostType?) -> String? {
        switch value {
        case .municipality: String(localized: "Public facility")
        case .station: String(localized: "Station")
        case .airport: String(localized: "Airport")
        case .commercialBuilding: String(localized: "Commercial building")
        case .convenienceStore: String(localized: "Convenience store")
        case .tobaccoShop: String(localized: "Tobacco shop")
        case .restaurantOrCafe: String(localized: "Restaurant or café")
        case .other: String(localized: "Other host")
        case .unknown, nil: nil
        }
    }

    /// ADR-0012 evidence label: short, plain, never alarming, never above the evidence.
    static func existence(_ value: ExistenceEvidence) -> String {
        switch value {
        case .official: String(localized: "Officially confirmed")
        case .operator: String(localized: "Confirmed by the operator")
        case .communityVerified: String(localized: "Confirmed by users")
        case .communityReported: String(localized: "User report · unconfirmed")
        case .unknown: String(localized: "Confirmation status unknown")
        }
    }

    /// ADR-0013 headline of how far the place has been confirmed, in plain words: who confirmed it, how many people,
    /// and whether anyone else has yet. Never above the evidence; no database terms.
    static func confirmationSummary(_ spot: Spot) -> String {
        switch spot.verification.existenceTier {
        case .official: String(localized: "Officially confirmed")
        case .operator: String(localized: "Confirmed by the operator")
        case .communityVerified:
            if let count = spot.verification.confirmations, count >= 2 {
                String(localized: "Confirmed by \(count) users")
            } else {
                String(localized: "Confirmed by users")
            }
        case .communityReported: String(localized: "Reported by one user · no one else has confirmed it yet")
        case .unknown: String(localized: "Confirmation status unknown")
        }
    }

    static func task(_ kind: CoverageTaskKind) -> String {
        switch kind {
        case .needsConfirmation: String(localized: "Waiting for someone to confirm it's still here")
        case .needsLocationCheck: String(localized: "The exact spot could use a check")
        case .needsTypeCheck: String(localized: "What kind of place it is is unknown")
        case .needsAccessCheck: String(localized: "Who can use it is unknown")
        }
    }

    static func existenceSymbol(_ value: ExistenceEvidence) -> String {
        switch value {
        case .official: "checkmark.seal"
        case .operator: "building.2"
        case .communityVerified: "person.2"
        case .communityReported: "person"
        case .unknown: "questionmark.circle"
        }
    }

    /// Shown only when the pin is not the publisher's own point.
    static func locationNote(_ value: LocationPrecision?) -> String? {
        switch value {
        case .reviewedDerived: String(localized: "Location estimated from the address")
        case .communityPinned: String(localized: "Location pinned by a user")
        case .areaApproximate: ApproximateLocation.listNote(areaName: nil)
        case .unknown: String(localized: "Location precision unknown")
        case .publisherPoint, nil: nil
        }
    }

    /// "Last confirmed N days ago", a month for month-precision evidence, or a plain note once stale.
    static func confirmation(_ result: NearbyResult) -> String {
        let spot = result.spot
        if result.freshness == .stale { return String(localized: "Not confirmed for a while") }
        if let age = result.verificationAge {
            let days = Int(age / 86_400)
            return days == 0 ? String(localized: "Confirmed today") : String(localized: "Last confirmed \(days) days ago")
        }
        if let date = SpotFreshness.referenceDate(spot) {
            // The month is a UTC calendar month; formatting it in UTC keeps it the same month everywhere.
            let formatter = DateFormatter()
            formatter.timeZone = TimeZone(secondsFromGMT: 0)
            formatter.setLocalizedDateFormatFromTemplate("yMMMM")
            return String(localized: "Last reviewed \(formatter.string(from: date))")
        }
        return String(localized: "Confirmation date unknown")
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

    static func evidence(_ spot: Spot) -> String { existence(spot.verification.existenceTier) }

    static func evidence(_ value: String?, version: String?) -> String {
        guard let value, !value.isEmpty else { return String(localized: "Unknown") }
        if isCommunityReviewed(value, version: version) { return String(localized: "Reviewed user reports (not official)") }
        return value == "officialListing" && version == "evidence-quality.v1"
            ? String(localized: "Official listing") : String(localized: "Evidence confidence unknown")
    }

    /// A place backed by reviewed community reports (Issue #124). It must never read as an official listing.
    static func isCommunityReviewed(_ value: String?, version: String?) -> Bool {
        value == "communityReviewed" && version == "evidence-quality.v2"
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
        if days == 1 { return String(localized: "Verified 1 day ago") }
        return String(localized: "Verified \(days) days ago")
    }

    /// ADR-0017: the distance to a result, 「約○m」 when its pin is an area anchor rather than the place itself.
    static func distance(_ result: NearbyResult) -> String {
        ApproximateLocation.distance(distance(result.distanceMeters), approximate: result.spot.verification.isAreaApproximate)
    }

    /// ADR-0017 list note, nil for a pin that is the place's own point.
    static func approximateLocationNote(_ spot: Spot) -> String? {
        spot.verification.isAreaApproximate ? ApproximateLocation.listNote(areaName: spot.verification.locationArea?.name) : nil
    }

    /// 「この場所へ案内」 only for an exact point; 「この付近へ案内」 for an area anchor and for anything not known to be exact
    /// (ADR-0017, same rule as the Watch).
    static func navigationTitle(_ spot: Spot) -> String {
        ApproximateLocation.navigationTitle(precision: spot.verification.locationPrecision?.rawValue)
    }

    /// Same rule as `navigationTitle`: only the publisher's point or a user's on-site pin is the place's own position.
    static func isExactPoint(_ spot: Spot) -> Bool {
        ApproximateLocation.isExactPoint(spot.verification.locationPrecision?.rawValue)
    }

    /// Spot Detail: where the pin comes from, for every precision — including none at all (a spot cached before
    /// ADR-0012), which reads as unknown. Independent of the existence evidence; never inferred from it.
    static func precisionDescription(_ spot: Spot) -> String {
        switch spot.verification.locationPrecision {
        case .publisherPoint: String(localized: "Location shown by the publisher")
        case .communityPinned: String(localized: "Location shown by a user")
        case .areaApproximate: ApproximateLocation.listNote(areaName: spot.verification.locationArea?.name)
        case .reviewedDerived: String(localized: "Location estimated from the official address")
        case .unknown, nil: String(localized: "Location precision unknown")
        }
    }

    static func precisionSymbol(_ spot: Spot) -> String {
        switch spot.verification.locationPrecision {
        case .publisherPoint, .communityPinned: "mappin.circle"
        case .areaApproximate, .reviewedDerived: "mappin.and.ellipse"
        case .unknown, nil: "questionmark.circle"
        }
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
        let degrees = Int(result.bearingDegrees.rounded()) % 360
        return String(localized: "\(compassDirection(result.bearingDegrees)) (\(degrees)°)")
    }

    // A named direction reads faster than raw degrees; the degrees stay for precision.
    static func compassDirection(_ degrees: Double) -> String {
        let normalized = (degrees.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
        switch Int(((normalized + 22.5) / 45).rounded(.down)) % 8 {
        case 0: return String(localized: "North")
        case 1: return String(localized: "Northeast")
        case 2: return String(localized: "East")
        case 3: return String(localized: "Southeast")
        case 4: return String(localized: "South")
        case 5: return String(localized: "Southwest")
        case 6: return String(localized: "West")
        default: return String(localized: "Northwest")
        }
    }

    static func sourceNames(_ spot: Spot) -> String {
        sourceNames(spot.verification.sourceDisplayNames)
    }

    static func sourceNames(_ values: [String]) -> String {
        let names = values.filter {
            !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        return names.isEmpty ? String(localized: "Source name unavailable") : names.joined(separator: ", ")
    }
}
