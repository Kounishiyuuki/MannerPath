import Foundation

nonisolated struct SpotVerification: Codable, Sendable {
    // Only an accepted existence claim permits a spot to appear in nearby results.
    let acceptedExistenceEvidence: TriState
    // Stable server value; its scale and ranking weight are not defined yet.
    let evidenceQuality: String?
    let sourceDisplayNames: [String]
    let evidenceQualityVersion: String?
    let sources: [SpotSource]?
    // ADR-0012 trust axes (docs/API.md `verification`). Optional so a spot cached before them still decodes;
    // `existenceTier` then falls back conservatively to evidenceQuality.
    var existence: ExistenceEvidence? = nil
    var locationPrecision: LocationPrecision? = nil
    var confirmations: Int? = nil
    // "YYYY-MM": the month the evidence was last reviewed.
    var lastReviewedMonth: String? = nil
    // ADR-0017: the area/host an areaApproximate pin represents. Optional, so a spot cached before it still decodes.
    var locationArea: LocationArea? = nil

    init(
        acceptedExistenceEvidence: TriState,
        evidenceQuality: String?,
        sourceDisplayNames: [String],
        evidenceQualityVersion: String? = nil,
        sources: [SpotSource]? = nil,
        existence: ExistenceEvidence? = nil,
        locationPrecision: LocationPrecision? = nil,
        confirmations: Int? = nil,
        lastReviewedMonth: String? = nil,
        locationArea: LocationArea? = nil
    ) {
        self.acceptedExistenceEvidence = acceptedExistenceEvidence
        self.evidenceQuality = evidenceQuality
        self.sourceDisplayNames = sourceDisplayNames
        self.evidenceQualityVersion = evidenceQualityVersion
        self.sources = sources
        self.existence = existence
        self.locationPrecision = locationPrecision
        self.confirmations = confirmations
        self.lastReviewedMonth = lastReviewedMonth
        self.locationArea = locationArea
    }

    /// The pin is a reviewed area anchor, not the place's own point (ADR-0017).
    var isAreaApproximate: Bool { locationPrecision == .areaApproximate }

    /// Who stands behind the place's existence. Without the ADR-0012 object only the two long-standing values are
    /// trusted; anything else is `.unknown`, which is never presented as confirmed.
    var existenceTier: ExistenceEvidence {
        if let existence { return existence }
        if evidenceQuality == "officialListing" && evidenceQualityVersion == "evidence-quality.v1" { return .official }
        if evidenceQuality == "communityReviewed" && evidenceQualityVersion == "evidence-quality.v2" { return .communityVerified }
        return .unknown
    }

    func age(at date: Date, lastVerifiedAt: Date?) -> TimeInterval? {
        guard let lastVerifiedAt else { return nil }
        let age = date.timeIntervalSince(lastVerifiedAt)
        return age >= 0 ? age : nil
    }
}

// `unknown` also stands for a tier added after this build: shown, labelled as unconfirmed, never as verified.
nonisolated enum ExistenceEvidence: String, Codable, Hashable, Sendable {
    case official, `operator`, communityVerified, communityReported, unknown

    init(wire: String) { self = Self(rawValue: wire) ?? .unknown }

    /// Official, operator or corroborated community evidence — what "verified only" keeps.
    var isVerified: Bool { self == .official || self == .operator || self == .communityVerified }
}

// A value added after this build reads as `unknown`, which is never presented as an exact point.
nonisolated enum LocationPrecision: String, Codable, Hashable, Sendable {
    case publisherPoint, reviewedDerived, communityPinned, areaApproximate, unknown

    init(wire: String) { self = Self(rawValue: wire) ?? .unknown }
}

nonisolated struct LocationArea: Codable, Hashable, Sendable {
    let name: String
    let kind: String
}

nonisolated struct SpotSource: Codable, Hashable, Sendable {
    let id: String
    let displayName: String
    let licenseName: String?
    let licenseURL: String?
    let attributionText: String?
}
