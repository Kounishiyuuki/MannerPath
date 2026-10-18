import Foundation
import CoreLocation
import Testing
@testable import MannerPathWatch_Watch_App

@MainActor
struct WatchSyncRefreshTests {
    private func cache() throws -> WatchStore {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return WatchStore(directory: directory)
    }
    private func payload(revision: UInt64, at date: Date) -> WatchSnapshot {
        WatchSnapshot(schemaVersion: 1, revision: revision, generatedAt: Date(timeIntervalSince1970: date.timeIntervalSince1970.rounded(.down)),
                      snapshotID: UUID(), spots: [], sources: [])
    }

    @Test func legacySnapshotTimestampSeparatesMissingUnknownRecentAndOldSavedData() throws {
        let store = try cache()
        defer { try? FileManager.default.removeItem(at: store.directory) }
        let model = WatchNearbyModel(store: store, activateConnectivity: false, widgetReloader: {})
        let checkedAt = Date(timeIntervalSince1970: 1_800_000_000)
        model.refreshClock(at: checkedAt)
        #expect(model.savedDataState == .notSynced)
        #expect(model.syncState == .idle)

        let unconfirmed = payload(revision: 1, at: .distantPast)
        #expect(model.receive(snapshotData: try WatchCodec.encode(unconfirmed), preferenceData: nil))
        model.refreshClock(at: checkedAt)
        #expect(model.savedDataState == .unconfirmed)
        #expect(model.snapshot?.spots.isEmpty == true)

        let confirmed = payload(revision: 2, at: checkedAt)
        #expect(model.receive(snapshotData: try WatchCodec.encode(confirmed), preferenceData: nil))
        model.refreshClock(at: checkedAt)
        #expect(model.savedDataState == .recentSavedEmpty, "Legacy v1 timestamps describe recent saved data, not successful tile refresh")
        model.refreshClock(at: checkedAt.addingTimeInterval(3_601))
        #expect(model.savedDataState == .stale)
        model.refreshClock(at: checkedAt.addingTimeInterval(-1))
        #expect(model.savedDataState == .unconfirmed, "A future timestamp cannot confirm freshness")
    }

    @Test func waitingAndFailedRequestsDoNotBecomeSuccessfulEmptyResults() throws {
        let store = try cache()
        defer { try? FileManager.default.removeItem(at: store.directory) }
        var completion: (@MainActor (Data?) -> Void)?
        let model = WatchNearbyModel(store: store, activateConnectivity: false,
                                     snapshotRequester: { completion = $0 }, widgetReloader: {})
        model.requestSync()
        #expect(model.syncState == .waiting && model.savedDataState == .notSynced)
        completion?(nil)
        #expect(model.syncState == .failed && model.savedDataState == .notSynced)
        model.requestSync()
        #expect(model.syncState == .waiting && !model.syncRequestFailed)
        let confirmed = payload(revision: 1, at: Date(timeIntervalSince1970: 1_800_000_000))
        completion?(try WatchCodec.encode(confirmed))
        model.refreshClock(at: confirmed.generatedAt)
        #expect(model.syncState == .idle && model.savedDataState == .recentSavedEmpty)
        #expect(model.snapshot?.generatedAt == confirmed.generatedAt)
    }

    @Test func failedAndRecoveredRequestsPreserveOldDataEvidence() throws {
        let store = try cache()
        defer { try? FileManager.default.removeItem(at: store.directory) }
        let checkedAt = Date(timeIntervalSince1970: 1_800_000_000)
        let old = payload(revision: 1, at: checkedAt.addingTimeInterval(-7_200))
        try store.acceptSnapshot(WatchCodec.encode(old))
        var completion: (@MainActor (Data?) -> Void)?
        let model = WatchNearbyModel(store: store, activateConnectivity: false,
                                     snapshotRequester: { completion = $0 }, widgetReloader: {})
        model.refreshClock(at: checkedAt)
        model.requestSync()
        #expect(model.syncState == .waiting && model.savedDataState == .stale)
        completion?(nil)
        #expect(model.syncState == .failed && model.savedDataState == .stale)
        model.requestSync()
        completion?(try WatchCodec.encode(old))
        model.refreshClock(at: checkedAt)
        #expect(model.syncState == .idle && model.savedDataState == .stale)
        #expect(model.snapshot == old, "A recovered connection is not a fresh iPhone tile update")
    }

    @Test func freshEmptyReceiptClearsWarningAndPersistsWithoutRevivingOldLocation() throws {
        let store = try cache()
        defer { try? FileManager.default.removeItem(at: store.directory) }
        let old = payload(revision: 1, at: .now.addingTimeInterval(-7_200))
        try store.acceptSnapshot(WatchCodec.encode(old))
        var reloads = 0
        let model = WatchNearbyModel(store: store, activateConnectivity: false, widgetReloader: { reloads += 1 })
        #expect(model.snapshotIsOld)
        let observed = Date()
        model.locationManager(CLLocationManager(), didUpdateLocations: [
            CLLocation(coordinate: CLLocationCoordinate2D(latitude: 0, longitude: 0), altitude: 0,
                       horizontalAccuracy: 5, verticalAccuracy: 5, timestamp: observed)
        ])
        model.refreshClock(at: observed.addingTimeInterval(61))
        let fresh = payload(revision: 2, at: .now)
        #expect(model.receive(snapshotData: try WatchCodec.encode(fresh), preferenceData: nil))
        #expect(model.snapshot?.spots.isEmpty == true && !model.snapshotIsOld)
        #expect(model.latitude == nil && model.accuracyMeters == nil)
        #expect(WatchWidgetState.evaluate(store.snapshot(), at: .now) == .empty)
        let restarted = WatchNearbyModel(store: store, activateConnectivity: false, widgetReloader: {})
        #expect(restarted.snapshot == fresh && !restarted.snapshotIsOld)
        #expect(!model.receive(snapshotData: try WatchCodec.encode(old), preferenceData: nil))
        #expect(model.snapshot == fresh && store.snapshot() == fresh)
        #expect(model.receive(snapshotData: try WatchCodec.encode(fresh), preferenceData: nil))
        #expect(model.snapshot?.generatedAt == fresh.generatedAt)
        #expect(reloads == 1, "Only a newly persisted snapshot requests a widget reload")
    }

    @Test func disconnectedThenSuccessfulRequestUsesReceiptOnlyAndDoesNotDoubleRequest() throws {
        let store = try cache()
        defer { try? FileManager.default.removeItem(at: store.directory) }
        let old = payload(revision: 1, at: .now.addingTimeInterval(-7_200))
        try store.acceptSnapshot(WatchCodec.encode(old))
        var completion: (@MainActor (Data?) -> Void)?
        var calls = 0
        let model = WatchNearbyModel(store: store, activateConnectivity: false, snapshotRequester: {
            calls += 1; completion = $0
        }, widgetReloader: {})
        model.requestSync()
        model.requestSync()
        #expect(calls == 1 && model.isSyncing && model.snapshot == old && model.snapshotIsOld)
        completion?(nil)
        #expect(model.syncRequestFailed && !model.isSyncing && store.snapshot() == old)
        model.requestSync()
        #expect(calls == 2 && model.snapshotIsOld)
        let fresh = payload(revision: 2, at: .now)
        completion?(try WatchCodec.encode(fresh))
        #expect(!model.syncRequestFailed && !model.isSyncing && !model.snapshotIsOld)
        #expect(model.snapshot == fresh && store.snapshot() == fresh)
    }

    @Test func malformedConflictingAndStaleRepliesDoNotRefreshSavedData() throws {
        let store = try cache()
        defer { try? FileManager.default.removeItem(at: store.directory) }
        let old = payload(revision: 5, at: .now.addingTimeInterval(-7_200))
        try store.acceptSnapshot(WatchCodec.encode(old))
        var reply: Data? = Data("{}".utf8)
        let model = WatchNearbyModel(store: store, activateConnectivity: false, snapshotRequester: { $0(reply) }, widgetReloader: {})
        model.requestSync()
        #expect(model.syncRequestFailed && model.snapshotIsOld && store.snapshot() == old)
        reply = try WatchCodec.encode(payload(revision: 5, at: .now))
        model.requestSync()
        #expect(model.syncRequestFailed && store.snapshot() == old)
        reply = try WatchCodec.encode(payload(revision: 4, at: .now))
        model.requestSync()
        #expect(model.syncRequestFailed && store.snapshot() == old)
        reply = try WatchCodec.encode(old)
        model.requestSync()
        #expect(!model.syncRequestFailed && model.snapshotIsOld && model.snapshot == old)
        model.locationManager(CLLocationManager(), didFailWithError: CLError(.locationUnknown))
        model.refreshClock()
        #expect(model.snapshot == old && store.snapshot() == old && model.snapshotIsOld)
    }

    @Test func newerContextWinsOverAnOlderPendingRequestReply() throws {
        let store = try cache()
        defer { try? FileManager.default.removeItem(at: store.directory) }
        let old = payload(revision: 1, at: .now.addingTimeInterval(-7_200))
        try store.acceptSnapshot(WatchCodec.encode(old))
        var completion: (@MainActor (Data?) -> Void)?
        let model = WatchNearbyModel(store: store, activateConnectivity: false, snapshotRequester: { completion = $0 }, widgetReloader: {})
        model.requestSync()
        let fresh = payload(revision: 3, at: .now)
        #expect(model.receive(snapshotData: try WatchCodec.encode(fresh), preferenceData: nil))
        completion?(try WatchCodec.encode(old))
        #expect(!model.syncRequestFailed && !model.isSyncing && model.snapshot == fresh)
    }

    @Test func failedDiskWriteNeverClaimsSuccessfulSync() throws {
        let store = try cache()
        try FileManager.default.removeItem(at: store.directory)
        let model = WatchNearbyModel(store: store, activateConnectivity: false, snapshotRequester: {
            $0(try? WatchCodec.encode(payload(revision: 1, at: .now)))
        }, widgetReloader: {})
        model.requestSync()
        #expect(model.syncRequestFailed && model.snapshot == nil && store.snapshot() == nil)
    }
}
