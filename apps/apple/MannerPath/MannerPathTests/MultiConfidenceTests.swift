import Foundation
import Testing
@testable import MannerPath

// ADR-0012: lower-confidence listings are searchable by default, labelled for what they are, and never shown as
// verified above their evidence — on iPhone and on Watch.
struct MultiConfidenceTests {
    private let tile = SlippyTile(z: 14, x: 14553, y: 6449)!
    private let origin = SpotCoordinate(latitude: 35.7112, longitude: 139.77377)
    private let now = ISO8601DateFormatter().date(from: "2026-10-01T00:00:00Z")!

    // 29, 23 ------------------------------------------------------------------------------------------------
    @Test func tileVerificationDecodesAndAFutureTierStaysUnconfirmed() throws {
        let data = try body([
            wire(1, evidence: "officialListing", version: "evidence-quality.v1", lastVerifiedAt: "2026-08-18",
                 verification: axes("official", "publisherPoint", nil, "2026-08")),
            wire(2, evidence: "communityReported", version: "evidence-quality.v3",
                 verification: axes("communityReported", "communityPinned", 1, "2026-09"),
                 extra: ["spotType": "ashtray", "hostType": "convenienceStore", "accessType": "public"]),
            wire(3, evidence: "futureEvidence", version: "evidence-quality.v9",
                 verification: axes("someFutureTier", "someFuturePrecision", 3, "2026-09")),
            // An older server: no ADR-0012 fields at all.
            wire(4, evidence: "communityReviewed", version: "evidence-quality.v2"),
            // A future verification shape: its axes are ignored, never guessed.
            wire(5, evidence: "officialListing", version: "evidence-quality.v1", lastVerifiedAt: "2026-08-18",
                 verification: ["version": "spot-verification.v2", "existence": "communityReported", "locationPrecision": "x",
                                "confirmations": 1, "lastReviewedMonth": "2026-09"]),
            wire(6, evidence: "communityVerified", version: "evidence-quality.v3",
                 verification: axes("communityVerified", "communityPinned", 2, "2026-09"),
                 extra: ["spotType": "facilitySmokingRoom", "spotSubtype": "smokingCorner", "accessType": "facilityOnly",
                         "accessDetail": "ticketedUsersOnly", "hostType": "futureHost"])
        ])
        let spots = try TileSpotMapper.map(JSONDecoder().decode(TileBodyV1.self, from: data), requestedTile: tile).spots
        #expect(spots.count == 6, "no new value discards a spot or the tile")
        #expect(spots.map(\.verification.existenceTier) == [.official, .communityReported, .unknown, .communityVerified, .official, .communityVerified])
        #expect(spots[1].hostType == .convenienceStore)
        #expect(spots[1].verification.locationPrecision == .communityPinned)
        #expect(spots[1].verification.confirmations == 1)
        #expect(spots[2].verification.locationPrecision == .unknown)
        #expect(!spots[2].verification.existenceTier.isVerified, "an unrecognised tier is never verified")
        #expect(spots[3].verification.locationPrecision == nil)
        #expect(spots[4].verification.lastReviewedMonth == nil, "an unknown verification version is not read")
        #expect(spots[5].spotSubtype == .smokingCorner)
        #expect(spots[5].accessDetail == .ticketedUsersOnly)
        #expect(spots[5].hostType == .unknown)
        #expect(SpotPresentation.access(spots[5]) == String(localized: "Ticket holders only"))
        #expect(SpotPresentation.type(spots[5]) == String(localized: "Smoking corner"))
    }

    @Test func spotsCachedBeforeADR0012StillDecode() throws {
        // A Spot encoded by the previous build has none of the new keys.
        let json = #"""
        {"id":"sp_old","latitude":35,"longitude":139,"tileId":"14/1/1","spotType":"ashtray","accessType":"public",
         "environment":"unknown","supportsPaper":"unknown","supportsHeated":"unknown","lifecycle":"active",
         "verification":{"acceptedExistenceEvidence":"yes","evidenceQuality":"officialListing","sourceDisplayNames":[],
         "evidenceQualityVersion":"evidence-quality.v1"}}
        """#
        let spot = try JSONDecoder().decode(Spot.self, from: Data(json.utf8))
        #expect(spot.spotSubtype == nil && spot.accessDetail == nil)
        #expect(spot.verification.existenceTier == .official)
    }

    // 26, 27 ------------------------------------------------------------------------------------------------
    @Test func defaultSearchKeepsLowerConfidenceAndConfirmedOnlyExcludesSingleReports() {
        let spots = [
            spot("official", tier: .official, meters: 300),
            spot("verified", tier: .communityVerified, meters: 200),
            spot("reported", tier: .communityReported, meters: 100),
            spot("future", tier: .unknown, meters: 150)
        ]
        let all = NearbySearch.rank(spots, from: origin, at: now).map(\.spot.id)
        #expect(Set(all) == ["official", "verified", "reported", "future"], "coverage first: nothing is hidden by default")

        var filters = NearbyFilters()
        filters.verifiedEvidenceOnly = true
        #expect(NearbySearch.rank(spots, from: origin, filters: filters, at: now).map(\.spot.id) == ["verified", "official"])
    }

    @Test func rankingIsDistanceFirstWithSmallNamedFactors() {
        // A near single report beats a far official place; at equal distance the official one leads.
        let near = spot("reported-near", tier: .communityReported, meters: 100)
        let far = spot("official-far", tier: .official, meters: 1_000)
        #expect(NearbySearch.rank([far, near], from: origin, at: now).map(\.spot.id) == ["reported-near", "official-far"])
        let tie = [spot("reported", tier: .communityReported, meters: 200), spot("official", tier: .official, meters: 200)]
        #expect(NearbySearch.rank(tie, from: origin, at: now).map(\.spot.id) == ["official", "reported"])
        // The largest combined factor stays well under 2x, so no tier can outrank a place twice as close.
        #expect(NearbyRanking.factor(evidence: .communityReported, freshness: .stale, access: .customerOnly) < 2)
        #expect(NearbyRanking.factor(evidence: .official, freshness: .fresh, access: .public) == 1)
    }

    @Test func freshnessMatchesTheServerPolicyAndStaleStaysListed() {
        let day: TimeInterval = 86_400
        #expect(SpotFreshness.of(spot("a", tier: .official, meters: 10, verified: now.addingTimeInterval(-365 * day)), at: now) == .fresh)
        #expect(SpotFreshness.of(spot("b", tier: .official, meters: 10, verified: now.addingTimeInterval(-366 * day)), at: now) == .aging)
        #expect(SpotFreshness.of(spot("c", tier: .official, meters: 10, verified: now.addingTimeInterval(-731 * day)), at: now) == .stale)
        #expect(SpotFreshness.of(spot("d", tier: .communityReported, meters: 10, month: "2026-09"), at: now) == .fresh)
        #expect(SpotFreshness.of(spot("e", tier: .communityReported, meters: 10), at: now) == .unknown)
        let stale = spot("stale", tier: .official, meters: 10, verified: now.addingTimeInterval(-2_000 * day))
        let results = NearbySearch.rank([stale], from: origin, at: now)
        #expect(results.map(\.spot.id) == ["stale"], "stale is a label, not a removal")
        #expect(SpotPresentation.confirmation(results[0]) == String(localized: "Not confirmed for a while"))
    }

    @Test func labelsAreNaturalAndNeverOverstate() {
        #expect(SpotPresentation.existence(.communityReported) == String(localized: "User report · unconfirmed"))
        #expect(SpotPresentation.existence(.communityVerified) == String(localized: "Confirmed by users"))
        #expect(SpotPresentation.existence(.official) == String(localized: "Officially confirmed"))
        #expect(SpotPresentation.locationNote(.reviewedDerived) == String(localized: "Location estimated from the address"))
        #expect(SpotPresentation.locationNote(.publisherPoint) == nil)
        #expect(SpotPresentation.host(.unknown) == nil, "an unstated host shows nothing rather than a guess")
    }

    // 28 ----------------------------------------------------------------------------------------------------
    @Test func watchSnapshotCarriesTierAndAccessAndOlderSnapshotsStillDecode() throws {
        var reported = spot("reported", tier: .communityReported, meters: 50)
        reported.accessDetail = .ticketedUsersOnly
        let built = WatchSnapshotBuilder.build(spots: [reported, spot("official", tier: .official, meters: 80)],
                                               sources: [], near: origin, at: now)
        let decoded = try WatchCodec.snapshot(WatchCodec.encode(built))
        let byID = Dictionary(uniqueKeysWithValues: decoded.spots.map { ($0.id, $0) })
        #expect(byID["reported"]?.existenceTier == "communityReported")
        #expect(byID["reported"]?.accessDetail == "ticketedUsersOnly")
        #expect(byID["official"]?.existenceTier == "official")

        // A snapshot written by an older iPhone build has no tier: only the long-standing official value is trusted.
        var legacy = try JSONSerialization.jsonObject(with: WatchCodec.encode(built)) as! [String: Any]
        legacy["spots"] = (legacy["spots"] as! [[String: Any]]).map { spot in
            spot.filter { $0.key != "existence" && $0.key != "accessDetail" }
        }
        let old = try WatchCodec.snapshot(JSONSerialization.data(withJSONObject: legacy))
        let oldByID = Dictionary(uniqueKeysWithValues: old.spots.map { ($0.id, $0) })
        #expect(oldByID["official"]?.existenceTier == "official")
        #expect(oldByID["reported"]?.existenceTier == "unknown")
    }

    @Test func newSpotClaimIsSentOnlyWhereTheDeploymentAcceptsIt() throws {
        var draft = ReportDraft(type: .missing, proposedLocation: ReportCoordinate(latitude: 35.7, longitude: 139.7))
        draft.claim = ReportClaim(spotType: "ashtray", accessType: "public", hostType: "convenienceStore", hostName: "店")
        let old = ReportLimits(noteMaxLength: 280, maxBodyBytes: 4096)
        let oldBody = try JSONSerialization.jsonObject(with: ReportRequest.encoded(draft: draft, installId: UUID(), limits: old)) as! [String: Any]
        #expect(oldBody["claim"] == nil, "a deployment before ADR-0012 would reject the unknown field")

        var current = old
        current.acceptsNewSpotClaim = true
        let body = try JSONSerialization.jsonObject(with: ReportRequest.encoded(draft: draft, installId: UUID(), limits: current)) as! [String: Any]
        let claim = try #require(body["claim"] as? [String: Any])
        #expect(claim["spotType"] as? String == "ashtray")
        #expect(claim["hostType"] as? String == "convenienceStore")
        #expect(claim["environment"] == nil, "an unstated field is not sent")

        var bad = draft
        bad.claim?.accessDetail = "ticketedUsersOnly"
        #expect(throws: ReportValidationError.invalidClaim) { try ReportRequest.encoded(draft: bad, installId: UUID(), limits: current) }
        var wrongType = ReportDraft(type: .exists, spotId: "sp_01V64NN31G72E5KJJ5W22W1A1J")
        wrongType.claim = ReportClaim(spotType: "ashtray")
        #expect(throws: ReportValidationError.unexpectedClaim) { try ReportRequest.encoded(draft: wrongType, installId: UUID(), limits: current) }
    }

    // MARK: - fixtures

    private func spot(_ id: String, tier: ExistenceEvidence, meters: Double, verified: Date? = nil, month: String? = nil) -> Spot {
        // Due north of the origin; 1° latitude ≈ 111.2 km.
        Spot(id: id, mergedInto: nil, name: id, latitude: origin.latitude + meters / 111_195, longitude: origin.longitude,
             tileId: tile.id, spotType: .ashtray, hostType: nil, accessType: .public, environment: .unknown,
             supportsPaper: .unknown, supportsHeated: .unknown, openingHours: nil, feeType: nil, floor: nil,
             entranceNote: nil, lifecycle: .active,
             verification: SpotVerification(acceptedExistenceEvidence: .yes,
                                            evidenceQuality: tier == .official ? "officialListing" : nil, sourceDisplayNames: [],
                                            evidenceQualityVersion: tier == .official ? "evidence-quality.v1" : nil,
                                            existence: tier, lastReviewedMonth: month),
             lastVerifiedAt: verified, createdAt: nil, updatedAt: nil)
    }

    private func axes(_ existence: String, _ precision: String, _ confirmations: Int?, _ month: String?) -> [String: Any] {
        ["version": "spot-verification.v1", "existence": existence, "locationPrecision": precision,
         "confirmations": confirmations as Any? ?? NSNull(), "lastReviewedMonth": month as Any? ?? NSNull()]
    }

    private func wire(_ number: Int, evidence: String, version: String, lastVerifiedAt: String? = nil,
                      verification: [String: Any]? = nil, extra: [String: Any] = [:]) -> [String: Any] {
        var spot: [String: Any] = [
            "id": "sp_" + String(repeating: "0", count: 25) + String(number), "name": NSNull(),
            "latitude": 35.7112, "longitude": 139.77377,
            "spotType": "unknown", "accessType": "unknown", "environment": "unknown",
            "supportsPaper": "unknown", "supportsHeated": "unknown",
            "openingHours": ["status": "none", "raw": NSNull(), "parsed": NSNull(), "timeZone": "Asia/Tokyo"],
            "lifecycle": "active", "evidenceQuality": evidence, "evidenceQualityVersion": version,
            "lastVerifiedAt": lastVerifiedAt as Any? ?? NSNull(), "sourceIds": ["src"]
        ]
        if let verification { spot["verification"] = verification }
        spot.merge(extra) { _, new in new }
        return spot
    }

    private func body(_ spots: [[String: Any]]) throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "schemaVersion": 1, "tile": tile.id, "revision": 1, "generatedAt": "2026-10-01T00:00:00Z", "spots": spots,
            "sources": [["id": "src", "displayName": "Source", "licenseName": NSNull(), "licenseUrl": NSNull(),
                         "attributionText": NSNull()]]
        ])
    }
}
