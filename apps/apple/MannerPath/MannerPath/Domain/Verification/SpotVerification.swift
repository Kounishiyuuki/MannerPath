import Foundation

nonisolated struct SpotVerification: Codable, Sendable {
    // Only an accepted existence claim permits a spot to appear in nearby results.
    let acceptedExistenceEvidence: TriState
    // Stable server value; its scale and ranking weight are not defined yet.
    let evidenceQuality: String?
    let sourceDisplayNames: [String]
    let evidenceQualityVersion: String?
    let sources: [SpotSource]?

    init(
        acceptedExistenceEvidence: TriState,
        evidenceQuality: String?,
        sourceDisplayNames: [String],
        evidenceQualityVersion: String? = nil,
        sources: [SpotSource]? = nil
    ) {
        self.acceptedExistenceEvidence = acceptedExistenceEvidence
        self.evidenceQuality = evidenceQuality
        self.sourceDisplayNames = sourceDisplayNames
        self.evidenceQualityVersion = evidenceQualityVersion
        self.sources = sources
    }

    func age(at date: Date, lastVerifiedAt: Date?) -> TimeInterval? {
        guard let lastVerifiedAt else { return nil }
        let age = date.timeIntervalSince(lastVerifiedAt)
        return age >= 0 ? age : nil
    }
}

nonisolated struct SpotSource: Codable, Sendable {
    let id: String
    let displayName: String
    let licenseName: String?
    let licenseURL: String?
    let attributionText: String?
}
