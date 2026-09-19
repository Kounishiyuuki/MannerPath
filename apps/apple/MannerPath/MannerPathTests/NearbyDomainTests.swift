import Foundation
import Testing
@testable import MannerPath

struct NearbyDomainTests {
    private let origin = SpotCoordinate(latitude: 35, longitude: 139)
    private let now = Date(timeIntervalSince1970: 10_000)

    @Test func triStateDecodingKeepsNoDistinctFromUnknown() throws {
        let decoder = JSONDecoder()

        #expect(try decoder.decode(TriState.self, from: Data(#""yes""#.utf8)) == .yes)
        #expect(try decoder.decode(TriState.self, from: Data(#""no""#.utf8)) == .no)
        #expect(try decoder.decode(TriState.self, from: Data(#""unknown""#.utf8)) == .unknown)
        #expect(try decoder.decode(TriState.self, from: Data(#""futureValue""#.utf8)) == .unknown)
    }

    @Test func futureEnumValuesDecodeWithoutPublishingUnknownSpot() throws {
        let json = #"""
        {
          "id": "future", "latitude": 35, "longitude": 139, "tileId": "0/0/0",
          "spotType": "futureType", "hostType": "futureHost",
          "accessType": "futureAccess", "environment": "futureEnvironment",
          "supportsPaper": "futureSupport", "supportsHeated": "no",
          "feeType": "futureFee", "lifecycle": "futureLifecycle",
          "verification": {
            "acceptedExistenceEvidence": "futureEvidence",
            "evidenceQuality": "futureQuality", "sourceDisplayNames": []
          },
          "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z"
        }
        """#
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let spot = try decoder.decode(Spot.self, from: Data(json.utf8))
        #expect(spot.spotType == .unknown)
        #expect(spot.hostType == .unknown)
        #expect(spot.accessType == .unknown)
        #expect(spot.environment == .unknown)
        #expect(spot.supportsPaper == .unknown)
        #expect(spot.supportsHeated == .no)
        #expect(spot.lifecycle == .unknown)
        #expect(spot.verification.acceptedExistenceEvidence == .unknown)
        #expect(spot.verification.evidenceQuality == "futureQuality")
        #expect(spot.feeType?.rawValue == "futureFee")
        #expect(NearbySearch.rank([spot], from: origin, at: now).isEmpty)
    }

    @Test func fixtureStoreHostDoesNotPassPublicationGate() throws {
        let spots = try FixtureSpotRepository().allSpots()
        #expect(spots.count == 2)
        #expect(spots.contains { $0.hostType == .convenienceStore })

        let results = NearbySearch.rank(
            spots,
            from: SpotCoordinate(latitude: 35.681237, longitude: 139.767125),
            at: now
        )
        #expect(results.map(\.spot.id) == ["fixture-designated-area"])
    }

    @Test func lifecycleMergeAndExistenceEvidenceAreSeparateGates() {
        let candidates = [
            makeSpot(id: "published"),
            makeSpot(id: "no-evidence", existence: .no),
            makeSpot(id: "unknown-evidence", existence: .unknown),
            makeSpot(id: "closed", lifecycle: .temporarilyClosed),
            makeSpot(id: "removed", lifecycle: .removed),
            makeSpot(id: "unknown-lifecycle", lifecycle: .unknown),
            makeSpot(id: "merged", mergedInto: "published")
        ]

        #expect(NearbySearch.rank(candidates, from: origin, at: now).map(\.spot.id) == ["published"])
    }

    @Test func explicitTobaccoIncompatibilityBeatsDistance() {
        let candidates = [
            makeSpot(id: "no", longitude: 139.0001, paper: .no),
            makeSpot(id: "unknown", longitude: 139.001, paper: .unknown),
            makeSpot(id: "yes", longitude: 139.002, paper: .yes)
        ]
        var filters = NearbyFilters()
        filters.tobaccoType = .paper

        #expect(NearbySearch.rank(candidates, from: origin, filters: filters, at: now).map(\.spot.id) == ["unknown", "yes"])

        filters.requireConfirmedTobaccoSupport = true
        #expect(NearbySearch.rank(candidates, from: origin, filters: filters, at: now).map(\.spot.id) == ["yes"])
    }

    @Test func heatedAndAccessFiltersDistinguishUnknownFromExplicitNo() {
        let candidates = [
            makeSpot(id: "customer", longitude: 139.0001, access: .customerOnly),
            makeSpot(id: "unknown", longitude: 139.001, access: .unknown, heated: .unknown),
            makeSpot(id: "heated-no", longitude: 139.0015, heated: .no),
            makeSpot(id: "public-yes", longitude: 139.002, heated: .yes)
        ]
        var filters = NearbyFilters()
        filters.publicAccessOnly = true
        filters.tobaccoType = .heated

        #expect(NearbySearch.rank(candidates, from: origin, filters: filters, at: now).map(\.spot.id) == ["unknown", "public-yes"])

        filters.requireConfirmedPublicAccess = true
        filters.requireConfirmedTobaccoSupport = true
        #expect(NearbySearch.rank(candidates, from: origin, filters: filters, at: now).map(\.spot.id) == ["public-yes"])

        filters.publicAccessOnly = false
        #expect(NearbySearch.rank(candidates, from: origin, filters: filters, at: now).map(\.spot.id) == ["public-yes"])
    }

    @Test func distanceBearingAndFreshnessAreComputedFromCoordinatesAndObservationDate() throws {
        let observed = makeSpot(id: "east", longitude: 139.001, lastVerifiedAt: now.addingTimeInterval(-3_600))
        let unknownDate = makeSpot(id: "unknown-date", longitude: 139.002, lastVerifiedAt: nil)
        let futureDate = makeSpot(id: "future-date", longitude: 139.003, lastVerifiedAt: now.addingTimeInterval(60))
        let results = NearbySearch.rank([observed, unknownDate, futureDate], from: origin, at: now)

        let east = try #require(results.first)
        #expect(east.spot.id == "east")
        #expect(abs(east.distanceMeters - 91.1) < 1)
        #expect(abs(east.bearingDegrees - 90) < 0.01)
        #expect(east.verificationAge == 3_600)
        #expect(results[1].verificationAge == nil)
        #expect(results[2].verificationAge == nil)

        var filters = NearbyFilters()
        filters.verifiedWithin = 4_000
        #expect(NearbySearch.rank([observed, unknownDate, futureDate], from: origin, filters: filters, at: now).map(\.spot.id) == ["east"])
    }

    @Test func distanceAndTypeFiltersThenStableIDBreakTies() {
        let candidates = [
            makeSpot(id: "b", longitude: 139.001),
            makeSpot(id: "a", longitude: 139.001),
            makeSpot(id: "far", longitude: 139.01),
            makeSpot(id: "invalid", longitude: 181),
            makeSpot(id: "different-type", longitude: 139.0001, spotType: .publicSmokingRoom)
        ]
        var filters = NearbyFilters()
        filters.spotTypes = [.ashtray]
        filters.maximumDistanceMeters = 150

        #expect(NearbySearch.rank(candidates, from: origin, filters: filters, at: now).map(\.spot.id) == ["a", "b"])
        #expect(NearbySearch.rank(candidates, from: SpotCoordinate(latitude: 91, longitude: 139), at: now).isEmpty)
    }

    private func makeSpot(
        id: String,
        longitude: Double = 139,
        spotType: SpotType = .ashtray,
        access: AccessType = .public,
        paper: TriState = .yes,
        heated: TriState = .yes,
        lifecycle: SpotLifecycle = .active,
        existence: TriState = .yes,
        mergedInto: String? = nil,
        lastVerifiedAt: Date? = nil
    ) -> Spot {
        Spot(
            id: id,
            mergedInto: mergedInto,
            name: nil,
            latitude: 35,
            longitude: longitude,
            tileId: "0/0/0",
            spotType: spotType,
            hostType: nil,
            accessType: access,
            environment: .unknown,
            supportsPaper: paper,
            supportsHeated: heated,
            openingHours: nil,
            feeType: nil,
            floor: nil,
            entranceNote: nil,
            lifecycle: lifecycle,
            verification: SpotVerification(
                acceptedExistenceEvidence: existence,
                evidenceQuality: nil,
                sourceDisplayNames: []
            ),
            lastVerifiedAt: lastVerifiedAt,
            createdAt: now,
            updatedAt: now
        )
    }
}
