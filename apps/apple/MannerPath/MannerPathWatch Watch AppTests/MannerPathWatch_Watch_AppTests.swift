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

    private func snapshot(_ spots: [WatchSpot], revision: UInt64 = 1,
                          at date: Date? = nil) -> WatchSnapshot {
        WatchSnapshot(schemaVersion: 1, revision: revision, generatedAt: date ?? now,
                      snapshotID: UUID(), spots: spots,
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

    @Test func widgetStatesUseSavedSnapshotOnly() {
        #expect(WatchWidgetState.evaluate(nil, at: now) == .unavailable)
        #expect(WatchWidgetState.evaluate(snapshot([]), at: now) == .empty)
        #expect(WatchWidgetState.evaluate(snapshot([spot("a")]), at: now) == .saved)
        #expect(WatchWidgetState.evaluate(snapshot([spot("a")]), at: now.addingTimeInterval(3_601)) == .stale)
        #expect(WatchWidgetState.evaluate(snapshot([spot("a")], at: now.addingTimeInterval(1)), at: now) == .stale)
    }

    @Test func groupMigrationKeepsNewestStateAndSurvivesMissingOrCorruptOldFiles() throws {
        let privateStore = try store()
        let groupStore = try store()
        defer {
            try? FileManager.default.removeItem(at: privateStore.directory)
            try? FileManager.default.removeItem(at: groupStore.directory)
        }
        let oldSnapshot = snapshot([spot("old")], revision: 1)
        let newSnapshot = snapshot([spot("new")], revision: 2)
        try WatchCodec.encode(oldSnapshot).write(
            to: privateStore.directory.appendingPathComponent("nearby-watch-v1.json"))
        let oldPreferences = preferences(tobacco: "paper")
        try WatchCodec.encode(oldPreferences).write(
            to: privateStore.directory.appendingPathComponent("preferences-watch-v1.json"))

        let privateFallback = WatchStore.migrate(privateDirectory: privateStore.directory,
                                                 groupDirectory: nil)
        #expect(privateFallback.snapshot() == oldSnapshot)
        #expect(privateFallback.preferences() == oldPreferences)
        let migrated = WatchStore.migrate(privateDirectory: privateStore.directory,
                                          groupDirectory: groupStore.directory)
        #expect(migrated.snapshot() == oldSnapshot)
        #expect(migrated.preferences() == oldPreferences)

        try Data("corrupt".utf8).write(
            to: groupStore.directory.appendingPathComponent("preferences-watch-v1.json"), options: .atomic)
        #expect(WatchStore.migrate(privateDirectory: privateStore.directory,
                                   groupDirectory: groupStore.directory).preferences() == oldPreferences)
        try WatchCodec.encode(oldPreferences).write(
            to: groupStore.directory.appendingPathComponent("preferences-watch-v1.json"), options: .atomic)
        try WatchCodec.encode(newSnapshot).write(
            to: groupStore.directory.appendingPathComponent("nearby-watch-v1.json"), options: .atomic)
        try Data("corrupt".utf8).write(
            to: privateStore.directory.appendingPathComponent("preferences-watch-v1.json"), options: .atomic)
        let repeated = WatchStore.migrate(privateDirectory: privateStore.directory,
                                          groupDirectory: groupStore.directory)
        #expect(repeated.snapshot() == newSnapshot)
        #expect(repeated.preferences() == oldPreferences)

        try FileManager.default.removeItem(at: groupStore.directory.appendingPathComponent("preferences-watch-v1.json"))
        let partial = WatchStore.migrate(privateDirectory: privateStore.directory,
                                         groupDirectory: groupStore.directory)
        #expect(partial.snapshot() == newSnapshot)
        #expect(partial.preferences() == .defaults())
    }

    @Test func migrationReconcilesNewerPrivateSnapshotAndPreferences() throws {
        let privateStore = try store()
        let groupStore = try store()
        defer {
            try? FileManager.default.removeItem(at: privateStore.directory)
            try? FileManager.default.removeItem(at: groupStore.directory)
        }
        let newer = snapshot([spot("newer")], revision: 3)
        let older = snapshot([spot("older")], revision: 2)
        try WatchCodec.encode(newer).write(
            to: privateStore.directory.appendingPathComponent("nearby-watch-v1.json"))
        try WatchCodec.encode(older).write(
            to: groupStore.directory.appendingPathComponent("nearby-watch-v1.json"))
        let newerPreferences = preferences(tobacco: "heated")
        let olderPreferences = WatchPreferences.defaults()
        try WatchCodec.encode(newerPreferences).write(
            to: privateStore.directory.appendingPathComponent("preferences-watch-v1.json"))
        try WatchCodec.encode(olderPreferences).write(
            to: groupStore.directory.appendingPathComponent("preferences-watch-v1.json"))

        let reconciled = WatchStore.migrate(privateDirectory: privateStore.directory,
                                            groupDirectory: groupStore.directory)
        #expect(reconciled.snapshot() == newer)
        #expect(reconciled.preferences() == newerPreferences)
        #expect(groupStore.snapshot() == newer)
        #expect(groupStore.preferences() == newerPreferences)

        try WatchCodec.encode(olderPreferences).write(
            to: privateStore.directory.appendingPathComponent("preferences-watch-v1.json"), options: .atomic)
        let stillNewer = WatchStore.migrate(privateDirectory: privateStore.directory,
                                            groupDirectory: groupStore.directory)
        #expect(stillNewer.preferences() == newerPreferences)
        #expect(groupStore.preferences() == newerPreferences)
    }

    @Test func codecRoundTripRetainsUnknownAndAttribution() throws {
        let original = snapshot([spot("a", type: "unknown", access: "unknown", paper: "unknown")])
        let decoded = try WatchCodec.snapshot(WatchCodec.encode(original))
        #expect(decoded.snapshotID == original.snapshotID)
        #expect(decoded.revision == original.revision)
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

    @Test func revisionOrdersSnapshotsIndependentlyOfGeneratedTime() throws {
        let cache = try store()
        defer { try? FileManager.default.removeItem(at: cache.directory) }
        let first = snapshot([spot("first")], revision: 10, at: now)
        let newer = snapshot([spot("newer")], revision: 11, at: now.addingTimeInterval(-10))
        #expect(try cache.acceptSnapshot(WatchCodec.encode(first)) != nil)
        #expect(try cache.acceptSnapshot(WatchCodec.encode(newer)) != nil)
        #expect(cache.snapshot()?.spots.map(\.id) == ["newer"])
        let stale = snapshot([spot("stale")], revision: 9, at: now.addingTimeInterval(100))
        #expect(try cache.acceptSnapshot(WatchCodec.encode(stale)) == nil)
        #expect(try cache.acceptSnapshot(WatchCodec.encode(newer)) == nil)
        let conflict = snapshot([spot("conflict")], revision: 11, at: newer.generatedAt)
        #expect(throws: Error.self) { try cache.acceptSnapshot(WatchCodec.encode(conflict)) }
        let reusedIdentity = WatchSnapshot(schemaVersion: 1, revision: 11,
                                           generatedAt: newer.generatedAt,
                                           snapshotID: newer.snapshotID,
                                           spots: [spot("changed-under-same-id")], sources: newer.sources)
        #expect(throws: Error.self) { try cache.acceptSnapshot(WatchCodec.encode(reusedIdentity)) }
        #expect(cache.snapshot() == newer)
    }

    @Test func malformedAndUnsupportedTransfersPreserveCache() throws {
        let cache = try store()
        defer { try? FileManager.default.removeItem(at: cache.directory) }
        let valid = snapshot([spot("valid")], revision: 5)
        try cache.acceptSnapshot(WatchCodec.encode(valid))
        #expect(throws: Error.self) { try cache.acceptSnapshot(Data("broken".utf8)) }
        let unsupported = WatchSnapshot(schemaVersion: 2, revision: 6,
                                        generatedAt: now.addingTimeInterval(20), snapshotID: UUID(),
                                        spots: [spot("unsupported")], sources: valid.sources)
        #expect(throws: Error.self) { try cache.acceptSnapshot(WatchCodec.encode(unsupported)) }
        #expect(cache.snapshot() == valid)
    }

    @Test func attributionVariantsSurviveOfflineCodecAndCache() throws {
        let first = WatchSource(id: "source", displayName: "Publisher", licenseName: "CC BY",
                                licenseURL: nil, attributionText: "Attribution A")
        let second = WatchSource(id: "source", displayName: "Publisher", licenseName: "CC BY",
                                 licenseURL: nil, attributionText: "Attribution B")
        let original = WatchSnapshot(schemaVersion: 1, revision: 1, generatedAt: now,
                                     snapshotID: UUID(), spots: [spot("a")], sources: [first, second])
        let data = try WatchCodec.encode(original)
        let decoded = try WatchCodec.snapshot(data)
        #expect(decoded.sources(for: decoded.spots[0]).map(\.attributionText) ==
                ["Attribution A", "Attribution B"])
        let cache = try store()
        defer { try? FileManager.default.removeItem(at: cache.directory) }
        try cache.acceptSnapshot(data)
        let offline = try #require(WatchStore(directory: cache.directory).snapshot())
        #expect(offline.sources(for: offline.spots[0]).map(\.attributionText) ==
                ["Attribution A", "Attribution B"])
    }

    @Test func malformedSourceReferenceIsRejected() throws {
        let invalidSpot = WatchSpot(id: "a", name: "a", latitude: 0, longitude: 0,
                                    spotType: "ashtray", accessType: "public", supportsPaper: "yes",
                                    supportsHeated: "unknown", lifecycle: "active",
                                    evidenceQuality: nil, evidenceQualityVersion: nil,
                                    lastVerifiedAt: nil, openingHours: nil, sourceIDs: ["missing"])
        #expect(throws: Error.self) {
            try WatchCodec.snapshot(WatchCodec.encode(snapshot([invalidSpot])))
        }
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

    @Test @MainActor func changingTobaccoToAnyClearsConfirmedSupport() throws {
        let cache = try store()
        defer { try? FileManager.default.removeItem(at: cache.directory) }
        try cache.acceptSnapshot(WatchCodec.encode(snapshot([
            spot("unknown", paper: "unknown"), spot("no", longitude: 0.001, paper: "no")
        ])))
        let model = WatchNearbyModel(store: cache, activateConnectivity: false)
        model.setTobacco("paper")
        model.setConfirmedTobacco(true)
        #expect(model.results.map(\.spot.id).isEmpty)
        model.setTobacco(nil)
        #expect(model.preferences.tobaccoType == nil)
        #expect(model.preferences.requireConfirmedTobaccoSupport == false)
        #expect(model.results.map(\.spot.id) == ["unknown", "no"])
        #expect(WatchStore(directory: cache.directory).preferences().requireConfirmedTobaccoSupport == false)
    }

    @Test @MainActor func turningPublicOffClearsConfirmedPublic() throws {
        let cache = try store()
        defer { try? FileManager.default.removeItem(at: cache.directory) }
        try cache.acceptSnapshot(WatchCodec.encode(snapshot([
            spot("unknown", access: "unknown"),
            spot("customer", longitude: 0.001, access: "customerOnly")
        ])))
        let model = WatchNearbyModel(store: cache, activateConnectivity: false)
        model.setPublicOnly(true)
        model.setConfirmedPublic(true)
        #expect(model.results.map(\.spot.id).isEmpty)
        model.setPublicOnly(false)
        #expect(model.preferences.publicAccessOnly == false)
        #expect(model.preferences.requireConfirmedPublicAccess == false)
        #expect(model.results.map(\.spot.id) == ["unknown", "customer"])
        #expect(WatchStore(directory: cache.directory).preferences().requireConfirmedPublicAccess == false)
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
        #expect(WatchNavigation.fallback(hasLocation: true) ==
                String(localized: "If Maps cannot route, use straight-line distance and bearing above."))
        #expect(WatchNavigation.fallback(hasLocation: false) ==
                String(localized: "Watch location is needed for straight-line distance and bearing."))
    }
}
