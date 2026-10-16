import Foundation
import Testing
@testable import MannerPath

struct WatchSyncTests {
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    @Test func preferenceUpdatePreservesPreviouslyTransferredSnapshot() {
        let snapshot = Data("snapshot".utf8)
        let preferences = Data("preferences".utf8)
        let context = PhoneWatchSync.updatedContext(
            previous: ["snapshotV1": snapshot], snapshotData: nil, preferenceData: preferences
        )
        #expect(context["snapshotV1"] as? Data == snapshot)
        #expect(context["preferencesV1"] as? Data == preferences)
    }

    @Test func producerRevisionPersistsAndAdvancesOnlyForChangedContent() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = PhoneWatchSnapshotStore(directory: directory)
        let first = candidate(at: now, sources: [])
        let saved = try store.prepare(first)
        #expect(saved.revision == 1)
        let unchanged = try store.prepare(candidate(at: now.addingTimeInterval(100), sources: []))
        #expect(unchanged.revision == 1)
        #expect(unchanged.snapshotID == saved.snapshotID)
        #expect(unchanged.generatedAt == saved.generatedAt)

        let restarted = PhoneWatchSnapshotStore(directory: directory)
        let source = WatchSource(id: "municipal", displayName: "Ward", licenseName: nil,
                                 licenseURL: nil, attributionText: "A")
        let changed = try restarted.prepare(candidate(at: now.addingTimeInterval(-100), sources: [source]))
        #expect(changed.revision == 2)
        #expect(changed.generatedAt < saved.generatedAt)
        #expect(restarted.snapshot()?.revision == 2)
    }

    @Test func builderPreservesBothAttributionVariantsForOneSourceID() throws {
        let a = SpotSource(id: "municipal", displayName: "Ward", licenseName: "CC BY",
                           licenseURL: nil, attributionText: "Attribution A")
        let b = SpotSource(id: "municipal", displayName: "Ward", licenseName: "CC BY",
                           licenseURL: nil, attributionText: "Attribution B")
        let emptyURL = SpotSource(id: "municipal", displayName: "Ward", licenseName: "CC BY",
                                  licenseURL: "", attributionText: "Attribution A")
        let spot = Spot(
            id: "spot", mergedInto: nil, name: "Area", latitude: 35, longitude: 139,
            tileId: "14/1/1", spotType: .unknown, hostType: nil, accessType: .unknown,
            environment: .unknown, supportsPaper: .unknown, supportsHeated: .unknown,
            openingHours: nil, feeType: nil, floor: nil, entranceNote: nil, lifecycle: .active,
            verification: SpotVerification(acceptedExistenceEvidence: .yes,
                                           evidenceQuality: "officialListing", sourceDisplayNames: ["Ward"],
                                           evidenceQualityVersion: "evidence-quality.v1", sources: [a]),
            lastVerifiedAt: nil, createdAt: nil, updatedAt: nil
        )
        let built = WatchSnapshotBuilder.build(
            spots: [spot], sources: [a, b, emptyURL], near: SpotCoordinate(latitude: 35, longitude: 139), at: now
        )
        let reorderedInput = WatchSnapshotBuilder.build(
            spots: [spot], sources: [emptyURL, b, a],
            near: SpotCoordinate(latitude: 35, longitude: 139), at: now
        )
        let decoded = try WatchCodec.snapshot(WatchCodec.encode(built))
        #expect(decoded.spots[0].sourceIDs == ["municipal"])
        #expect(Set(decoded.sources(for: decoded.spots[0]).compactMap(\.attributionText)) ==
                Set(["Attribution A", "Attribution B"]))
        #expect(decoded.sources.count == 3)
        #expect(built.sources == reorderedInput.sources)
    }

    @Test func multiSourceSnapshotRoundTripHasNoOrphansOrDuplicateRecords() throws {
        let a = SpotSource(id: "municipal-a", displayName: "A", licenseName: "CC BY",
                           licenseURL: "https://example.org/a", attributionText: "A attribution")
        let b = SpotSource(id: "municipal-b", displayName: "B", licenseName: "Open license",
                           licenseURL: "https://example.org/b", attributionText: "B attribution")
        let unused = SpotSource(id: "unused", displayName: "Unused", licenseName: nil,
                                licenseURL: nil, attributionText: nil)
        let spot = Spot(
            id: "multi-source", mergedInto: nil, name: "Area", latitude: 35, longitude: 139,
            tileId: "14/1/1", spotType: .ashtray, hostType: nil, accessType: .unknown,
            environment: .unknown, supportsPaper: .unknown, supportsHeated: .unknown,
            openingHours: nil, feeType: nil, floor: nil, entranceNote: nil, lifecycle: .active,
            verification: SpotVerification(acceptedExistenceEvidence: .yes,
                                           evidenceQuality: "officialListing", sourceDisplayNames: ["A", "B"],
                                           evidenceQualityVersion: "evidence-quality.v1", sources: [b, a]),
            lastVerifiedAt: nil, createdAt: nil, updatedAt: nil
        )
        let built = WatchSnapshotBuilder.build(
            spots: [spot], sources: [a, b, a, unused],
            near: SpotCoordinate(latitude: 35, longitude: 139), at: now
        )
        let decoded = try WatchCodec.snapshot(WatchCodec.encode(built))
        let watchSpot = try #require(decoded.spots.first)
        #expect(watchSpot.sourceIDs == ["municipal-a", "municipal-b"])
        #expect(decoded.sources.map(\.id) == watchSpot.sourceIDs)
        #expect(decoded.sources.count == 2)
        #expect(Set(decoded.sources(for: watchSpot).compactMap(\.attributionText)) ==
                Set(["A attribution", "B attribution"]))
        #expect(Set(watchSpot.sourceIDs).isSubset(of: Set(decoded.sources.map(\.id))))
    }

    @Test func confirmedEmptyRefreshAdvancesRevisionTimeAndSurvivesReopen() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = PhoneWatchSnapshotStore(directory: directory)
        let old = try store.prepare(candidate(at: now, sources: []), confirmedRefresh: true)
        let date = now.addingTimeInterval(7_200)
        let fresh = try store.prepare(candidate(at: date, sources: []), confirmedRefresh: true)
        #expect(fresh.spots.isEmpty && fresh.sources.isEmpty)
        #expect(fresh.revision == old.revision + 1 && fresh.generatedAt == date)
        #expect(fresh.snapshotID != old.snapshotID)
        #expect(PhoneWatchSnapshotStore(directory: directory).snapshot() == fresh)
        #expect(try store.prepare(candidate(at: date.addingTimeInterval(100), sources: [])) == fresh)
        #expect(try store.prepare(candidate(at: now, sources: []), confirmedRefresh: true) == fresh)
        #expect(try store.prepare(candidate(at: date, sources: []), confirmedRefresh: true) == fresh)
    }

    @Test func confirmedUnchangedNonemptyRefreshAdvancesWithoutChangingFacts() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = PhoneWatchSnapshotStore(directory: directory)
        let spot = WatchSpot(id: "one", name: "Synthetic", latitude: 0, longitude: 0,
                             spotType: "unknown", accessType: "unknown", supportsPaper: "unknown",
                             supportsHeated: "unknown", lifecycle: "active", evidenceQuality: nil,
                             evidenceQualityVersion: nil, lastVerifiedAt: nil, openingHours: nil, sourceIDs: [])
        func payload(_ date: Date) -> WatchSnapshot {
            WatchSnapshot(schemaVersion: 1, revision: 1, generatedAt: date, snapshotID: UUID(), spots: [spot], sources: [])
        }
        let old = try store.prepare(payload(now), confirmedRefresh: true)
        let fresh = try store.prepare(payload(now.addingTimeInterval(7_200)), confirmedRefresh: true)
        #expect(fresh.revision == old.revision + 1 && fresh.spots == old.spots && fresh.sources == old.sources)
    }

    @Test func watchRequestResendsOnlyValidatedSavedPayloadWithoutNewTime() throws {
        let saved = candidate(at: now, sources: [])
        let reply = PhoneWatchSync.snapshotReply(for: ["requestSnapshotV1": true], snapshot: saved)
        let data = try #require(reply["snapshotV1"] as? Data)
        #expect(try WatchCodec.snapshot(data) == saved)
        #expect(PhoneWatchSync.snapshotReply(for: ["requestSnapshotV1": true], snapshot: nil).isEmpty)
        #expect(PhoneWatchSync.snapshotReply(for: ["requestSnapshotV1": false], snapshot: saved).isEmpty)
        #expect(PhoneWatchSync.snapshotReply(for: ["other": true], snapshot: saved).isEmpty)
        #expect(PhoneWatchSync.snapshotReply(for: ["requestSnapshotV1": true, "extra": true], snapshot: saved).isEmpty)
    }

    @Test func cacheAgeMarkerDoesNotChangeCurrentRankingOrTop500Selection() {
        let date = Date()
        let spots = (0..<510).map { index in
            Spot(id: "synthetic-\(index)", mergedInto: nil, name: "Synthetic", latitude: 0,
                 longitude: Double(index + 1) / 100_000, tileId: "14/8192/8192", spotType: .ashtray,
                 hostType: nil, accessType: .unknown, environment: .unknown, supportsPaper: .unknown,
                 supportsHeated: .unknown, openingHours: nil, feeType: nil, floor: nil, entranceNote: nil,
                 lifecycle: .active, verification: SpotVerification(acceptedExistenceEvidence: .yes,
                     evidenceQuality: "officialListing", sourceDisplayNames: []),
                 lastVerifiedAt: date.addingTimeInterval(index.isMultiple(of: 2) ? -60 : -20_000_000),
                 createdAt: nil, updatedAt: nil)
        }
        let origin = SpotCoordinate(latitude: 0, longitude: 0)
        let fresh = WatchSnapshotBuilder.build(spots: spots, sources: [], near: origin, at: date)
        let cached = WatchSnapshotBuilder.build(spots: spots, sources: [], near: origin, at: date,
                                                snapshotGeneratedAt: .distantPast)
        #expect(fresh.spots.count == 500 && cached.spots == fresh.spots)
        #expect(cached.generatedAt == .distantPast && fresh.generatedAt == date)
    }

    private func candidate(at date: Date, sources: [WatchSource]) -> WatchSnapshot {
        WatchSnapshot(schemaVersion: 1, revision: 1, generatedAt: date, snapshotID: UUID(),
                      spots: [], sources: sources)
    }
}
