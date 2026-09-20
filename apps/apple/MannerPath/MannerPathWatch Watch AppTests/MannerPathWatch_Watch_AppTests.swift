import Foundation
import Testing
@testable import MannerPathWatch_Watch_App

struct MannerPathWatch_Watch_AppTests {
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    private func spot(_ id: String, longitude: Double = 0, type: String = "ashtray",
                      access: String = "public", paper: String = "yes",
                      verified: Date? = nil) -> WatchSpot {
        WatchSpot(id: id, name: id, latitude: 0, longitude: longitude,
                  spotType: type, accessType: access, supportsPaper: paper,
                  supportsHeated: "unknown", lifecycle: "active",
                  evidenceQuality: "officialListing", evidenceQualityVersion: "evidence-quality.v1",
                  lastVerifiedAt: verified, openingHours: nil, sourceIDs: ["source"])
    }

    private func snapshot(_ spots: [WatchSpot], at date: Date? = nil) -> WatchSnapshot {
        WatchSnapshot(schemaVersion: 1, generatedAt: date ?? now, snapshotID: UUID(), spots: spots,
                      sources: [WatchSource(id: "source", displayName: "Publisher",
                                            licenseName: "CC BY", licenseURL: "https://example.org",
                                            attributionText: "Publisher attribution")])
    }

    private func preferences(tobacco: String? = nil, confirmed: Bool = false,
                             publicOnly: Bool = false, confirmedPublic: Bool = false,
                             types: [String]? = nil, openNow: Bool = false,
                             recent: Int? = nil) -> WatchPreferences {
        WatchPreferences(schemaVersion: 1, generatedAt: now, tobaccoType: tobacco,
                         requireConfirmedTobaccoSupport: confirmed, publicAccessOnly: publicOnly,
                         requireConfirmedPublicAccess: confirmedPublic, spotTypes: types,
                         openNowOnly: openNow, officialEvidenceOnly: false,
                         verifiedWithinDays: recent)
    }

    private func store() throws -> WatchStore {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return WatchStore(directory: url)
    }

    @Test func codecRoundTripRetainsUnknownAndAttribution() throws {
        let original = snapshot([spot("a", type: "unknown", access: "unknown", paper: "unknown")])
        let decoded = try WatchCodec.snapshot(WatchCodec.encode(original))
        #expect(decoded.snapshotID == original.snapshotID)
        #expect(decoded.spots[0].spotType == "unknown")
        #expect(decoded.spots[0].supportsPaper == "unknown")
        #expect(decoded.sources[0].attributionText == "Publisher attribution")
    }

    @Test func futureEnumsDecodeWithoutBecomingConfirmed() throws {
        let decoded = try WatchCodec.snapshot(WatchCodec.encode(snapshot([
            spot("future-type", type: "futureType"),
            spot("future-support", longitude: 0.001, paper: "futureValue"),
            spot("unknown-type", longitude: 0.002, type: "unknown")
        ])))
        let visible = WatchRanking.topThree(decoded, latitude: 0, longitude: 0,
                                            preferences: preferences(tobacco: "paper", confirmed: true), at: now)
        #expect(visible.map(\.spot.id) == ["unknown-type"])
    }

    @Test func staleDuplicateAndMalformedTransfersPreserveCache() throws {
        let cache = try store()
        defer { try? FileManager.default.removeItem(at: cache.directory) }
        let first = snapshot([spot("first")])
        let newer = snapshot([spot("newer")], at: now.addingTimeInterval(10))
        #expect(try cache.acceptSnapshot(WatchCodec.encode(first)) != nil)
        #expect(try cache.acceptSnapshot(WatchCodec.encode(newer)) != nil)
        #expect(try cache.acceptSnapshot(WatchCodec.encode(first)) == nil)
        #expect(try cache.acceptSnapshot(WatchCodec.encode(newer)) == nil)
        #expect(throws: Error.self) { try cache.acceptSnapshot(Data("broken".utf8)) }
        let unsupported = WatchSnapshot(schemaVersion: 2, generatedAt: now.addingTimeInterval(20),
                                        snapshotID: UUID(), spots: [spot("unsupported")], sources: newer.sources)
        #expect(throws: Error.self) { try cache.acceptSnapshot(WatchCodec.encode(unsupported)) }
        #expect(cache.snapshot()?.spots.map(\.id) == ["newer"])
    }

    @Test func cachedLaunchAndPreferencesNeedNoPhone() throws {
        let cache = try store()
        defer { try? FileManager.default.removeItem(at: cache.directory) }
        try cache.acceptSnapshot(WatchCodec.encode(snapshot([
            spot("public"), spot("unknown", longitude: 0.001, access: "unknown")
        ])))
        let changed = preferences(publicOnly: true, confirmedPublic: true)
        try cache.acceptPreferences(WatchCodec.encode(changed))
        let reopened = WatchStore(directory: cache.directory)
        #expect(reopened.snapshot()?.spots.count == 2)
        #expect(reopened.preferences() == changed)
        let result = WatchRanking.topThree(try #require(reopened.snapshot()), latitude: 0, longitude: 0,
                                           preferences: reopened.preferences(), at: now)
        #expect(result.map(\.spot.id) == ["public"])
    }

    @Test func staleOrUnsupportedPreferencesDoNotReplaceLocalChoice() throws {
        let cache = try store()
        defer { try? FileManager.default.removeItem(at: cache.directory) }
        let local = preferences(tobacco: "paper", confirmed: true)
        try cache.saveLocalPreferences(local)
        #expect(try cache.acceptPreferences(WatchCodec.encode(preferences())) == nil)
        let future = WatchPreferences(schemaVersion: 2, generatedAt: now.addingTimeInterval(10),
                                      tobaccoType: nil, requireConfirmedTobaccoSupport: false,
                                      publicAccessOnly: false, requireConfirmedPublicAccess: false,
                                      spotTypes: nil, openNowOnly: false, officialEvidenceOnly: false,
                                      verifiedWithinDays: nil)
        #expect(throws: Error.self) { try cache.acceptPreferences(WatchCodec.encode(future)) }
        #expect(cache.preferences() == local)
    }

    @Test func watchLocationDeterminesTopThreeDistanceAndBearing() {
        let corpus = snapshot([spot("far", longitude: 0.04), spot("second", longitude: 0.02),
                               spot("first", longitude: 0.01), spot("third", longitude: 0.03)])
        let east = WatchRanking.topThree(corpus, latitude: 0, longitude: 0,
                                         preferences: preferences(), at: now)
        let west = WatchRanking.topThree(corpus, latitude: 0, longitude: 0.04,
                                         preferences: preferences(), at: now)
        #expect(east.map(\.spot.id) == ["first", "second", "third"])
        #expect(west.map(\.spot.id) == ["far", "third", "second"])
        #expect(east[0].bearingDegrees > 89 && east[0].bearingDegrees < 91)
        #expect(east[0].distanceMeters > 1_000)
    }

    @Test func quickFiltersKeepUnknownDistinctFromFalse() {
        let corpus = snapshot([spot("yes", longitude: 0.001),
                               spot("unknown", longitude: 0.002, access: "unknown", paper: "unknown"),
                               spot("no", longitude: 0.003, access: "customerOnly", paper: "no")])
        func ids(_ value: WatchPreferences) -> [String] {
            WatchRanking.topThree(corpus, latitude: 0, longitude: 0, preferences: value, at: now)
                .map(\.spot.id)
        }
        #expect(ids(preferences(tobacco: "paper")) == ["yes", "unknown"])
        #expect(ids(preferences(tobacco: "paper", confirmed: true)) == ["yes"])
        #expect(ids(preferences(publicOnly: true)) == ["yes", "unknown"])
        #expect(ids(preferences(publicOnly: true, confirmedPublic: true)) == ["yes"])
        let noLocation = WatchRanking.topThree(corpus, latitude: nil, longitude: nil,
                                               preferences: preferences(tobacco: "paper", confirmed: true), at: now)
        #expect(noLocation.map(\.spot.id) == ["yes"])
        #expect(noLocation[0].distanceMeters.isNaN)
    }

    @Test func freshnessUsesCurrentTimeAndUnknownHoursAreNotOpen() {
        let observed = now.addingTimeInterval(-89 * 86_400)
        let corpus = snapshot([spot("dated", verified: observed), spot("undated", longitude: 0.001)])
        let today = WatchRanking.topThree(corpus, latitude: 0, longitude: 0,
                                          preferences: preferences(), at: now)
        #expect(today[0].verificationAgeDays == 89)
        #expect(today[1].verificationAgeDays == nil)
        let later = WatchRanking.topThree(corpus, latitude: 0, longitude: 0,
                                          preferences: preferences(recent: 90),
                                          at: now.addingTimeInterval(2 * 86_400))
        #expect(later.isEmpty)
        #expect(WatchRanking.topThree(corpus, latitude: 0, longitude: 0,
                                      preferences: preferences(openNow: true), at: now).isEmpty)
        let justPast = snapshot([spot("boundary", verified: now.addingTimeInterval(-90 * 86_400 - 1))])
        #expect(WatchRanking.topThree(justPast, latitude: 0, longitude: 0,
                                      preferences: preferences(recent: 90), at: now).isEmpty)
    }

    @Test func navigationKeepsStraightLineFallback() {
        let destination = spot("destination", longitude: 0.01)
        let url = WatchNavigation.walkingURL(for: destination)
        #expect(url?.host == "maps.apple.com")
        #expect(url?.path == "/directions")
        if let url {
            #expect(URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.contains(URLQueryItem(name: "mode", value: "walking")) == true)
        }
        #expect(WatchNavigation.fallback(hasLocation: true).contains("bearing"))
        #expect(WatchNavigation.fallback(hasLocation: false).contains("needed"))
    }
}
