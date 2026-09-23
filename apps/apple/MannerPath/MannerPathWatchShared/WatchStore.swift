import Foundation

// Two independent files: a malformed preference transfer cannot disturb spot data.
nonisolated struct WatchStore {
    let directory: URL
    let fallbackDirectory: URL?

    init(directory: URL, fallbackDirectory: URL? = nil) {
        self.directory = directory
        self.fallbackDirectory = fallbackDirectory
    }

    static func applicationSupport() throws -> Self {
        let privateDirectory = try FileManager.default.url(for: .applicationSupportDirectory,
                                                           in: .userDomainMask, appropriateFor: nil, create: true)
        let groupDirectory = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: "group.com.kounishiyuuki.MannerPath"
        )
        return migrate(privateDirectory: privateDirectory, groupDirectory: groupDirectory)
    }

    // The Watch app can keep using its private cache if the group container is unavailable.
    // The widget then shows an unavailable state until sharing is restored.
    static func migrate(privateDirectory: URL, groupDirectory: URL?) -> Self {
        guard let groupDirectory else { return Self(directory: privateDirectory) }
        let privateSnapshotURL = privateDirectory.appendingPathComponent("nearby-watch-v1.json")
        let groupSnapshotURL = groupDirectory.appendingPathComponent("nearby-watch-v1.json")
        if let data = try? Data(contentsOf: privateSnapshotURL),
           let old = try? WatchCodec.snapshot(data) {
            let shared = (try? Data(contentsOf: groupSnapshotURL)).flatMap { try? WatchCodec.snapshot($0) }
            if old.revision > (shared?.revision ?? 0) {
                try? data.write(to: groupSnapshotURL, options: .atomic)
            }
        }
        let privatePreferencesURL = privateDirectory.appendingPathComponent("preferences-watch-v1.json")
        let groupPreferencesURL = groupDirectory.appendingPathComponent("preferences-watch-v1.json")
        if let data = try? Data(contentsOf: privatePreferencesURL),
           let old = try? WatchCodec.preferences(data) {
            let shared = (try? Data(contentsOf: groupPreferencesURL)).flatMap { try? WatchCodec.preferences($0) }
            if old.generatedAt > (shared?.generatedAt ?? .distantPast) {
                try? data.write(to: groupPreferencesURL, options: .atomic)
            }
        }
        return Self(directory: groupDirectory, fallbackDirectory: privateDirectory)
    }

    private var snapshotURL: URL { directory.appendingPathComponent("nearby-watch-v1.json") }
    private var preferencesURL: URL { directory.appendingPathComponent("preferences-watch-v1.json") }

    func snapshot() -> WatchSnapshot? {
        let shared = (try? Data(contentsOf: snapshotURL)).flatMap { try? WatchCodec.snapshot($0) }
        let old = fallbackDirectory.flatMap {
            (try? Data(contentsOf: $0.appendingPathComponent("nearby-watch-v1.json")))
                .flatMap { try? WatchCodec.snapshot($0) }
        }
        if let old, old.revision > (shared?.revision ?? 0) { return old }
        return shared ?? old
    }

    func preferences() -> WatchPreferences {
        let shared = (try? Data(contentsOf: preferencesURL)).flatMap { try? WatchCodec.preferences($0) }
        let old = fallbackDirectory.flatMap {
            (try? Data(contentsOf: $0.appendingPathComponent("preferences-watch-v1.json")))
                .flatMap { try? WatchCodec.preferences($0) }
        }
        if let old, old.generatedAt > (shared?.generatedAt ?? .distantPast) { return old }
        return shared ?? old ?? .defaults()
    }

    @discardableResult
    func acceptSnapshot(_ data: Data) throws -> WatchSnapshot? {
        let incoming = try WatchCodec.snapshot(data)
        if let previous = snapshot() {
            if incoming.revision < previous.revision { return nil }
            if incoming.revision == previous.revision {
                guard incoming == previous else { throw WatchPayloadError.invalid }
                return nil
            }
        }
        try data.write(to: snapshotURL, options: .atomic)
        return incoming
    }

    @discardableResult
    func acceptPreferences(_ data: Data) throws -> WatchPreferences? {
        let incoming = try WatchCodec.preferences(data)
        let current = preferences()
        guard incoming.generatedAt > current.generatedAt else { return nil }
        try data.write(to: preferencesURL, options: .atomic)
        return incoming
    }

    func saveLocalPreferences(_ value: WatchPreferences) throws {
        try WatchCodec.encode(value).write(to: preferencesURL, options: .atomic)
    }
}
