import Foundation

struct SpotVerification: Codable, Sendable {
    // Only an accepted existence claim permits a spot to appear in nearby results.
    let acceptedExistenceEvidence: TriState
    // Stable server value; its scale and ranking weight are not defined yet.
    let evidenceQuality: String?
    let sourceDisplayNames: [String]

    func age(at date: Date, lastVerifiedAt: Date?) -> TimeInterval? {
        guard let lastVerifiedAt else { return nil }
        let age = date.timeIntervalSince(lastVerifiedAt)
        return age >= 0 ? age : nil
    }
}
