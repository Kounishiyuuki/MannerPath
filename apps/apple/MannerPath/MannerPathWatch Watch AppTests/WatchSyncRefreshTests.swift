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

    @Test func neverSyncedProducerWithoutDataAndSuccessfulZeroPlacesAreDistinct() throws {
        let store = try cache()
        defer { try? FileManager.default.removeItem(at: store.directory) }
        let model = WatchNearbyModel(store: store, activateConnectivity: false, snapshotRequester: { _ in }, widgetReloader: {})
        #expect(model.snapshot == nil && !model.syncRequestFailed && !model.phoneHasNoSnapshot)
        model.requestSync()
        model.completeSyncReply(snapshotData: nil, unavailable: true)
        #expect(!model.isSyncing && model.phoneHasNoSnapshot && !model.syncRequestFailed)
        #expect(model.snapshot == nil && store.snapshot() == nil)
        model.requestSync()
        model.completeSyncReply(snapshotData: nil, unavailable: false)
        #expect(model.syncRequestFailed && !model.phoneHasNoSnapshot)
        let empty = payload(revision: 1, at: .now)
        model.requestSync()
        model.completeSyncReply(snapshotData: try WatchCodec.encode(empty), unavailable: false)
        #expect(!model.syncRequestFailed && !model.phoneHasNoSnapshot)
        #expect(model.snapshot == empty && model.results.isEmpty && !model.snapshotIsOld)
        #expect(WatchWidgetState.evaluate(store.snapshot(), at: .now) == .empty)
    }

    @Test func producerWithoutSnapshotNeverErasesSavedDataOrOverridesNewerContext() throws {
        let store = try cache()
        defer { try? FileManager.default.removeItem(at: store.directory) }
        let old = payload(revision: 1, at: .now.addingTimeInterval(-7_200))
        try store.acceptSnapshot(WatchCodec.encode(old))
        let model = WatchNearbyModel(store: store, activateConnectivity: false, snapshotRequester: { _ in }, widgetReloader: {})
        model.requestSync()
        model.completeSyncReply(snapshotData: nil, unavailable: true)
        #expect(model.phoneHasNoSnapshot && !model.syncRequestFailed)
        #expect(model.snapshot == old && model.snapshotIsOld && store.snapshot() == old)
        model.requestSync()
        let fresh = payload(revision: 2, at: .now)
        #expect(model.receive(snapshotData: try WatchCodec.encode(fresh), preferenceData: nil))
        model.completeSyncReply(snapshotData: nil, unavailable: true)
        #expect(!model.phoneHasNoSnapshot && !model.syncRequestFailed && !model.isSyncing)
        #expect(model.snapshot == fresh && store.snapshot() == fresh)
    }

    @Test func timeoutAllowsRetryAndLateRepliesAndTimersCannotCompleteAnotherRequest() throws {
        let store = try cache()
        defer { try? FileManager.default.removeItem(at: store.directory) }
        var completions: [@MainActor (Data?) -> Void] = []
        var timeouts: [@MainActor () -> Void] = []
        let model = WatchNearbyModel(store: store, activateConnectivity: false,
                                    snapshotRequester: { completions.append($0) }, widgetReloader: {},
                                    syncTimeoutScheduler: { timeouts.append($0) })
        model.requestSync()
        #expect(model.isSyncing && completions.count == 1 && timeouts.count == 1)
        timeouts[0]()
        #expect(!model.isSyncing && model.syncRequestFailed && model.snapshot == nil)
        model.requestSync()
        #expect(model.isSyncing && !model.syncRequestFailed && completions.count == 2)
        let first = payload(revision: 1, at: .now)
        completions[0](try WatchCodec.encode(first))
        timeouts[0]()
        #expect(model.isSyncing && model.snapshot == nil && !model.syncRequestFailed)
        let second = payload(revision: 2, at: .now)
        completions[1](try WatchCodec.encode(second))
        #expect(!model.isSyncing && !model.syncRequestFailed && model.snapshot == second)
        timeouts[1]()
        completions[0](nil)
        #expect(!model.syncRequestFailed && model.snapshot == second && store.snapshot() == second)
    }

    @Test func newerContextCompletesRequestBeforeTimeoutOrTransportFailure() throws {
        let store = try cache()
        defer { try? FileManager.default.removeItem(at: store.directory) }
        var completion: (@MainActor (Data?) -> Void)?
        var timeout: (@MainActor () -> Void)?
        let model = WatchNearbyModel(store: store, activateConnectivity: false,
                                    snapshotRequester: { completion = $0 }, widgetReloader: {},
                                    syncTimeoutScheduler: { timeout = $0 })
        model.requestSync()
        let fresh = payload(revision: 1, at: .now)
        #expect(model.receive(snapshotData: try WatchCodec.encode(fresh), preferenceData: nil))
        #expect(!model.isSyncing)
        timeout?()
        completion?(nil)
        #expect(!model.syncRequestFailed && !model.phoneHasNoSnapshot && model.snapshot == fresh)
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
