import Foundation
import Testing
@testable import MannerPath

// ADR-0017: an areaApproximate pin is a reviewed anchor of the area the place is confirmed to be inside. It decodes,
// survives the cache, is searchable, and every surface says it is approximate; exact pins read exactly as before.
struct ApproximateLocationTests {
    private let tile = SlippyTile(z: 14, x: 14553, y: 6449)!
    private let origin = SpotCoordinate(latitude: 35.7112, longitude: 139.77377)
    private let now = ISO8601DateFormatter().date(from: "2026-10-02T00:00:00Z")!

    @Test func areaApproximateDecodesWithItsAreaAndExactSpotsAreUnchanged() throws {
        let spots = try mapped([
            wire(1, verification: axes("areaApproximate", area: ["name": "上野恩賜公園", "kind": "park"])),
            wire(2, verification: axes("publisherPoint")),
            // An area on a non-approximate pin is ignored, never shown.
            wire(3, verification: axes("publisherPoint", area: ["name": "公園", "kind": "park"])),
            // An unsafe name is dropped; the pin stays approximate.
            wire(4, verification: axes("areaApproximate", area: ["name": "  \n ", "kind": "park"]))
        ])
        #expect(spots[0].verification.locationPrecision == .areaApproximate)
        #expect(spots[0].verification.locationArea == LocationArea(name: "上野恩賜公園", kind: "park"))
        #expect(spots[0].verification.isAreaApproximate)
        #expect(spots[1].verification.locationPrecision == .publisherPoint)
        #expect(spots[1].verification.locationArea == nil)
        #expect(!spots[1].verification.isAreaApproximate)
        #expect(spots[2].verification.locationArea == nil)
        #expect(spots[3].verification.isAreaApproximate && spots[3].verification.locationArea == nil)
    }

    @Test func spotsCachedBeforeADR0017StillDecodeAndRoundTrip() throws {
        let json = #"""
        {"id":"sp_old","latitude":35,"longitude":139,"tileId":"14/1/1","spotType":"ashtray","accessType":"public",
         "environment":"unknown","supportsPaper":"unknown","supportsHeated":"unknown","lifecycle":"active",
         "verification":{"acceptedExistenceEvidence":"yes","evidenceQuality":"officialListing","sourceDisplayNames":[],
         "evidenceQualityVersion":"evidence-quality.v1","existence":"official","locationPrecision":"publisherPoint"}}
        """#
        let old = try JSONDecoder().decode(Spot.self, from: Data(json.utf8))
        #expect(old.verification.locationArea == nil && !old.verification.isAreaApproximate)
        let approximate = spot("approx", precision: .areaApproximate, area: LocationArea(name: "上野恩賜公園", kind: "park"))
        let roundTripped = try JSONDecoder().decode(Spot.self, from: JSONEncoder().encode(approximate))
        #expect(roundTripped.verification.locationArea == approximate.verification.locationArea)
        #expect(roundTripped.verification.locationPrecision == .areaApproximate)
    }

    @Test func listDetailNavigationAndDistanceCopy() {
        let named = spot("approx", precision: .areaApproximate, area: LocationArea(name: "上野恩賜公園", kind: "park"))
        let unnamed = spot("approx2", precision: .areaApproximate, area: nil)
        let exact = spot("exact", precision: .publisherPoint, area: nil)
        #expect(SpotPresentation.approximateLocationNote(named) == String(localized: "Location is approximate, within \("上野恩賜公園")"))
        #expect(SpotPresentation.approximateLocationNote(unnamed) == String(localized: "Location is approximate, within this area"))
        #expect(SpotPresentation.approximateLocationNote(exact) == nil)
        #expect(ApproximateLocation.detailNote().isEmpty == false)
        #expect(SpotPresentation.navigationTitle(named) == String(localized: "Navigate to this area"))
        #expect(SpotPresentation.navigationTitle(exact) == String(localized: "Navigate to this place"))
        let approxResult = NearbyResult(spot: named, distanceMeters: 240, bearingDegrees: 0, verificationAge: nil)
        let exactResult = NearbyResult(spot: exact, distanceMeters: 240, bearingDegrees: 0, verificationAge: nil)
        #expect(SpotPresentation.distance(approxResult) == String(localized: "About \(SpotPresentation.distance(240))"))
        #expect(SpotPresentation.distance(exactResult) == SpotPresentation.distance(240), "an exact distance is unchanged")
        #expect(SpotPresentation.locationNote(.areaApproximate) != nil)
        #expect(SpotPresentation.locationNote(.publisherPoint) == nil)
    }

    @Test func onlyAnExactPointGetsTheExactCallToAction() {
        let place = String(localized: "Navigate to this place"), area = String(localized: "Navigate to this area")
        #expect(SpotPresentation.navigationTitle(spot("pp", precision: .publisherPoint, area: nil)) == place)
        #expect(SpotPresentation.navigationTitle(spot("cp", precision: .communityPinned, area: nil)) == place)
        // Area anchor, address-derived, unknown, a future wire value (decoded as .unknown) and a legacy cached spot with
        // no precision at all: never 「この場所へ案内」.
        for precision in [LocationPrecision.areaApproximate, .reviewedDerived, .unknown, LocationPrecision(wire: "someFuturePrecision"), nil] as [LocationPrecision?] {
            #expect(SpotPresentation.navigationTitle(spot("p", precision: precision, area: nil)) == area)
        }
    }

    @Test func displayableAreaNameRejectsUnsafeNames() {
        #expect(ApproximateLocation.displayableAreaName(" 上野恩賜公園 ") == "上野恩賜公園")
        #expect(ApproximateLocation.displayableAreaName("") == nil)
        #expect(ApproximateLocation.displayableAreaName("a\u{0007}b") == nil)
        #expect(ApproximateLocation.displayableAreaName(String(repeating: "あ", count: 81)) == nil)
        #expect(ApproximateLocation.displayableAreaName(nil) == nil)
    }

    @Test func approximateSpotsAreSearchableAndNeverHardFiltered() {
        let approx = spot("approx", precision: .areaApproximate, area: LocationArea(name: "上野恩賜公園", kind: "park"), meters: 100)
        let exact = spot("exact", precision: .publisherPoint, area: nil, meters: 300)
        #expect(NearbySearch.rank([exact, approx], from: origin, at: now).map(\.spot.id) == ["approx", "exact"],
                "no ranking factor: an approximate pin is ranked by its distance like any other")
        var filters = NearbyFilters()
        filters.verifiedEvidenceOnly = true
        #expect(Set(NearbySearch.rank([exact, approx], from: origin, filters: filters, at: now).map(\.spot.id)) == ["approx", "exact"])
    }

    @Test func coverageTaskAsksForTheExactLocation() {
        let approx = spot("approx", precision: .areaApproximate, area: nil)
        #expect(CoverageTasks.kinds(for: approx, at: now).contains(.needsLocationCheck))
    }

    @Test func watchSnapshotCarriesPrecisionAndArea() {
        let approx = spot("approx", precision: .areaApproximate, area: LocationArea(name: "上野恩賜公園", kind: "park"))
        let exact = spot("exact", precision: .publisherPoint, area: nil, meters: 50)
        let snapshot = WatchSnapshotBuilder.build(spots: [approx, exact], sources: [], near: origin, at: now)
        let byID = Dictionary(uniqueKeysWithValues: snapshot.spots.map { ($0.id, $0) })
        #expect(byID["approx"]?.isAreaApproximate == true)
        #expect(byID["approx"]?.locationAreaName == "上野恩賜公園")
        #expect(byID["exact"]?.isAreaApproximate == false)
        #expect(byID["exact"]?.locationAreaName == nil)
    }

    // MARK: - fixtures

    private func spot(_ id: String, precision: LocationPrecision?, area: LocationArea?, meters: Double = 100) -> Spot {
        Spot(id: id, mergedInto: nil, name: id, latitude: origin.latitude + meters / 111_195, longitude: origin.longitude,
             tileId: tile.id, spotType: .designatedOutdoorArea, hostType: nil, accessType: .public, environment: .unknown,
             supportsPaper: .unknown, supportsHeated: .unknown, openingHours: nil, feeType: nil, floor: nil,
             entranceNote: nil, lifecycle: .active,
             verification: SpotVerification(acceptedExistenceEvidence: .yes, evidenceQuality: "officialListing",
                                            sourceDisplayNames: [], evidenceQualityVersion: "evidence-quality.v1",
                                            existence: .official, locationPrecision: precision, lastReviewedMonth: "2026-09",
                                            locationArea: area),
             lastVerifiedAt: nil, createdAt: nil, updatedAt: nil)
    }

    private func axes(_ precision: String, area: [String: Any]? = nil) -> [String: Any] {
        var v: [String: Any] = ["version": "spot-verification.v1", "existence": "official", "locationPrecision": precision,
                                "confirmations": NSNull(), "lastReviewedMonth": "2026-09"]
        if let area { v["locationArea"] = area }
        return v
    }

    private func wire(_ number: Int, verification: [String: Any]) -> [String: Any] {
        ["id": "sp_" + String(repeating: "0", count: 25) + String(number), "name": NSNull(),
         "latitude": 35.7112, "longitude": 139.77377, "spotType": "designatedOutdoorArea", "accessType": "public",
         "environment": "unknown", "supportsPaper": "unknown", "supportsHeated": "unknown",
         "openingHours": ["status": "none", "raw": NSNull(), "parsed": NSNull(), "timeZone": "Asia/Tokyo"],
         "lifecycle": "active", "evidenceQuality": "officialListing", "evidenceQualityVersion": "evidence-quality.v1",
         "lastVerifiedAt": "2026-09-01", "sourceIds": ["src"], "verification": verification]
    }

    private func mapped(_ spots: [[String: Any]]) throws -> [Spot] {
        let data = try JSONSerialization.data(withJSONObject: [
            "schemaVersion": 1, "tile": tile.id, "revision": 1, "generatedAt": "2026-10-01T00:00:00Z", "spots": spots,
            "sources": [["id": "src", "displayName": "Source", "licenseName": NSNull(), "licenseUrl": NSNull(),
                         "attributionText": NSNull()]]
        ])
        return try TileSpotMapper.map(JSONDecoder().decode(TileBodyV1.self, from: data), requestedTile: tile).spots
    }
}
