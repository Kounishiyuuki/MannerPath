import Foundation

// Location precision on the Watch, in the same words as iPhone Spot Detail (DESIGN §5.6–5.7). Precision is where the
// pin comes from; it is a separate axis from existence evidence and is never inferred from it (or it from evidence).
nonisolated enum WatchPrecision {
    /// Detail: a description for every precision, including none at all (a snapshot from an older iPhone) → unknown.
    static func label(_ precision: String?, areaName: String?) -> String {
        switch precision {
        case "publisherPoint": String(localized: "Location shown by the publisher")
        case "communityPinned": String(localized: "Location shown by a user")
        case "areaApproximate": ApproximateLocation.listNote(areaName: areaName)
        case "reviewedDerived": String(localized: "Location estimated from the official address")
        default: String(localized: "Location precision unknown")
        }
    }

    /// List row: only when the pin is not the place's own point, so exact rows stay one glance long.
    static func listNote(_ precision: String?, areaName: String?) -> String? {
        ApproximateLocation.isExactPoint(precision) ? nil : label(precision, areaName: areaName)
    }

    static func symbol(_ precision: String?) -> String {
        switch precision {
        case "publisherPoint", "communityPinned": "mappin.circle"
        case "areaApproximate", "reviewedDerived": "mappin.and.ellipse"
        default: "questionmark.circle"
        }
    }

    /// Detail note for a pin that is neither exact nor an ADR-0017 area anchor (which has its own note).
    static func uncertainNote(_ precision: String?) -> String? {
        if ApproximateLocation.isExactPoint(precision) || ApproximateLocation.isApproximate(precision) { return nil }
        return String(localized: "The pin is not a confirmed position. Distance and bearing are to the pin.")
    }
}
