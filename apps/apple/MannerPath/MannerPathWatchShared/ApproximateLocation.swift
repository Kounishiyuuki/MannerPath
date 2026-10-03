import Foundation

// ADR-0017: an `areaApproximate` pin is a reviewed anchor of the park, station or facility the smoking place is
// confirmed to be inside — never the smoking place's own point. Every surface (list, detail, navigation, distance,
// VoiceOver, Watch, widget) says so in the same words. Shared by iPhone and Watch; pure strings in, strings out.
nonisolated enum ApproximateLocation {
    static let precisionValue = "areaApproximate"

    static func isApproximate(_ precision: String?) -> Bool { precision == precisionValue }

    /// Only a pin that is the place's own point may be called exact: the publisher's point or a user's on-site pin.
    /// Everything else — an area anchor, an address-derived point, unknown, a value this build does not know, or no
    /// value at all (a spot cached before ADR-0012) — is never presented as exact (no false confidence).
    static func isExactPoint(_ precision: String?) -> Bool { precision == "publisherPoint" || precision == "communityPinned" }

    /// The area name only when it is safe to show verbatim: trimmed, 1–80 characters, no control characters.
    static func displayableAreaName(_ raw: String?) -> String? {
        guard let name = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty, name.count <= 80,
              !name.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { return nil }
        return name
    }

    /// List row: 「位置は○○内の目安です」, or 「位置はこのエリア内の目安です」 without a showable name.
    static func listNote(areaName: String?) -> String {
        if let name = displayableAreaName(areaName) {
            return String(localized: "Location is approximate, within \(name)")
        }
        return String(localized: "Location is approximate, within this area")
    }

    /// Detail: the place is confirmed inside the area; its exact position is not.
    static func detailNote() -> String {
        String(localized: "The smoking place is confirmed to be inside this facility or park. Its exact position is not confirmed, so the pin is approximate.")
    }

    /// Navigation call to action from the wire precision: 「この場所へ案内」 only for an exact point, otherwise 「この付近へ案内」.
    static func navigationTitle(precision: String?) -> String {
        isExactPoint(precision) ? String(localized: "Navigate to this place") : String(localized: "Navigate to this area")
    }

    /// 「約○m」 for an approximate pin; an exact distance is returned unchanged.
    static func distance(_ formatted: String, approximate: Bool) -> String {
        approximate ? String(localized: "About \(formatted)") : formatted
    }
}
