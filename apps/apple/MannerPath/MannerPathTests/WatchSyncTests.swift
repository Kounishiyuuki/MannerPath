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

    private func candidate(at date: Date, sources: [WatchSource]) -> WatchSnapshot {
        WatchSnapshot(schemaVersion: 1, revision: 1, generatedAt: date, snapshotID: UUID(),
                      spots: [], sources: sources)
    }
}
