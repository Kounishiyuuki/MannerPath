import Foundation
import Testing
@testable import MannerPath

struct WatchSyncTests {
    @Test func preferenceUpdatePreservesPreviouslyTransferredSnapshot() {
        let snapshot = Data("snapshot".utf8)
        let preferences = Data("preferences".utf8)
        let context = PhoneWatchSync.updatedContext(
            previous: ["snapshotV1": snapshot], snapshotData: nil, preferenceData: preferences
        )
        #expect(context["snapshotV1"] as? Data == snapshot)
        #expect(context["preferencesV1"] as? Data == preferences)
    }
}
