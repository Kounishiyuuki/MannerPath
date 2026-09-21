import Foundation

nonisolated protocol ReportDraftStoring: Sendable {
    func load() throws -> ReportDraft?
    func save(_ draft: ReportDraft) throws
    func delete() throws
}

nonisolated struct FileReportDraftStore: ReportDraftStoring {
    let fileURL: URL

    init(directory: URL) { fileURL = directory.appending(path: "pending-report.json") }

    func load() throws -> ReportDraft? {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }
        return try JSONDecoder().decode(ReportDraft.self, from: Data(contentsOf: fileURL))
    }

    func save(_ draft: ReportDraft) throws {
        let directory = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                attributes: [.protectionKey: FileProtectionType.complete])
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete],
                                              ofItemAtPath: directory.path)
        let data = try JSONEncoder().encode(draft)
        try data.write(to: fileURL, options: [.atomic, .completeFileProtection])
    }

    func delete() throws {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return }
        try FileManager.default.removeItem(at: fileURL)
    }
}

nonisolated protocol InstallIDProviding: Sendable {
    func installID() -> UUID
}

nonisolated struct UserDefaultsInstallID: InstallIDProviding, @unchecked Sendable {
    let defaults: UserDefaults
    let key: String

    init(defaults: UserDefaults = .standard, key: String = "MannerPathReportInstallID") {
        self.defaults = defaults
        self.key = key
    }

    func installID() -> UUID {
        if let stored = defaults.string(forKey: key), let uuid = UUID(uuidString: stored) { return uuid }
        let uuid = UUID()
        defaults.set(uuid.uuidString, forKey: key)
        return uuid
    }
}
