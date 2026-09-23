import Foundation

// Two independent files: a malformed preference transfer cannot disturb spot data.
nonisolated struct WatchStore {
    let directory: URL

    static func applicationSupport() throws -> Self {
        guard let directory = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: "group.com.kounishiyuuki.MannerPath"
        ) else { throw WatchPayloadError.invalid }
        // Move the existing private Watch cache once so previously synced data stays offline.
        let old = try FileManager.default.url(for: .applicationSupportDirectory,
                                              in: .userDomainMask, appropriateFor: nil, create: true)
        for name in ["nearby-watch-v1.json", "preferences-watch-v1.json"] {
            let destination = directory.appendingPathComponent(name)
            let source = old.appendingPathComponent(name)
            if !FileManager.default.fileExists(atPath: destination.path),
               FileManager.default.fileExists(atPath: source.path) {
                try? FileManager.default.copyItem(at: source, to: destination)
            }
        }
        return Self(directory: directory)
    }

    private var snapshotURL: URL { directory.appendingPathComponent("nearby-watch-v1.json") }
    private var preferencesURL: URL { directory.appendingPathComponent("preferences-watch-v1.json") }

    func snapshot() -> WatchSnapshot? {
        guard let data = try? Data(contentsOf: snapshotURL) else { return nil }
        return try? WatchCodec.snapshot(data)
    }

    func preferences() -> WatchPreferences {
        guard let data = try? Data(contentsOf: preferencesURL),
              let value = try? WatchCodec.preferences(data) else { return .defaults() }
        return value
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
