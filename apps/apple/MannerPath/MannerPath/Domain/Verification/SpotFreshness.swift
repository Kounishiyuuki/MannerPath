import Foundation

// freshness.v1 (ADR-0012, docs/API.md): a label, never a filter the app applies by default. Old evidence without
// removal evidence stays listed as `stale`. Same boundaries as services/api/src/quality/freshness.ts.
nonisolated enum SpotFreshness: String, Sendable, Hashable {
    case fresh, aging, stale, unknown

    static let policyVersion = "freshness.v1"
    static let freshWithinDays = 365.0
    static let agingWithinDays = 730.0

    /// The observation date when there is one; otherwise the first day of the reviewed month, so month-precision
    /// evidence never looks fresher than it is. A missing or future date is `unknown`.
    static func of(_ spot: Spot, at now: Date) -> SpotFreshness {
        guard let reference = referenceDate(spot) else { return .unknown }
        let days = now.timeIntervalSince(reference) / 86_400
        guard days.isFinite, days >= 0 else { return .unknown }
        return days <= freshWithinDays ? .fresh : days <= agingWithinDays ? .aging : .stale
    }

    static func referenceDate(_ spot: Spot) -> Date? {
        if let lastVerifiedAt = spot.lastVerifiedAt { return lastVerifiedAt }
        guard let month = spot.verification.lastReviewedMonth else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let parts = month.split(separator: "-")
        guard parts.count == 2, let year = Int(parts[0]), let value = Int(parts[1]) else { return nil }
        return calendar.date(from: DateComponents(year: year, month: value, day: 1))
    }
}
