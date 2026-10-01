import Foundation

// coverage-tasks.v1 (ADR-0013): what the system would like someone nearby to check, derived on the device from the
// tile fields it already holds, so the server never learns where the user is. Same rules and order as
// services/api/src/coverage/tasks.ts; both are checked against contracts/coverage/coverage-tasks.v1.json.
// A task is a suggestion the user may ignore: nothing is assigned, counted per person, or pushed.
nonisolated enum CoverageTaskKind: String, Sendable, Hashable, CaseIterable {
    case needsConfirmation, needsLocationCheck, needsTypeCheck, needsAccessCheck
}

nonisolated enum CoverageTasks {
    static let rulesVersion = "coverage-tasks.v1"

    /// Only the ADR-0012 axes the server sent count; a spot cached before them yields no existence or location task.
    static func kinds(for spot: Spot, at now: Date) -> [CoverageTaskKind] {
        var kinds: [CoverageTaskKind] = []
        let v = spot.verification
        if v.existence == .communityReported || SpotFreshness.of(spot, at: now) == .stale { kinds.append(.needsConfirmation) }
        switch v.locationPrecision {
        case .unknown, .reviewedDerived: kinds.append(.needsLocationCheck)
        case .communityPinned where (v.confirmations ?? 0) < 2: kinds.append(.needsLocationCheck)
        default: break
        }
        if spot.spotType == .unknown { kinds.append(.needsTypeCheck) }
        if spot.accessType == .unknown { kinds.append(.needsAccessCheck) }
        return kinds
    }

    /// The nearby results worth a look, nearest first, at most `limit`. Only "is it still here?" counts for the
    /// nearby prompt: it is the one check a passer-by can answer in one tap.
    static func nearbyConfirmations(_ results: [NearbyResult], at now: Date, limit: Int = 3) -> [NearbyResult] {
        Array(results.filter { kinds(for: $0.spot, at: now).contains(.needsConfirmation) }
            .sorted { $0.distanceMeters < $1.distanceMeters }
            .prefix(limit))
    }
}
