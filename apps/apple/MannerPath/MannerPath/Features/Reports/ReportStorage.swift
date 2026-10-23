import Foundation

nonisolated protocol ReportDraftStoring: Sendable {
    func load() throws -> ReportDraft?
    func save(_ draft: ReportDraft) throws
    func delete() throws
    func submissionMarker() throws -> ReportSubmissionMarker?
    func markSubmissionAttempt() throws
    func markAcceptedForCleanup() throws
    func clearAcceptedCleanupMarker() throws
}

nonisolated enum ReportSubmissionMarker: String, Sendable {
    case attempted, accepted
}

nonisolated struct FileReportDraftStore: ReportDraftStoring {
    let fileURL: URL
    let submissionMarkerURL: URL

    init(directory: URL) {
        fileURL = directory.appending(path: "pending-report.json")
        submissionMarkerURL = directory.appending(path: "submission-state")
    }

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

    func submissionMarker() throws -> ReportSubmissionMarker? {
        guard FileManager.default.fileExists(atPath: submissionMarkerURL.path) else { return nil }
        guard let marker = ReportSubmissionMarker(rawValue: String(decoding: try Data(contentsOf: submissionMarkerURL), as: UTF8.self)) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        return marker
    }

    func markSubmissionAttempt() throws {
        try writeMarker(.attempted)
    }

    func markAcceptedForCleanup() throws {
        try writeMarker(.accepted)
    }

    private func writeMarker(_ marker: ReportSubmissionMarker) throws {
        let directory = submissionMarkerURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                attributes: [.protectionKey: FileProtectionType.complete])
        try Data(marker.rawValue.utf8).write(to: submissionMarkerURL, options: [.atomic, .completeFileProtection])
    }

    func clearAcceptedCleanupMarker() throws {
        guard FileManager.default.fileExists(atPath: submissionMarkerURL.path) else { return }
        try FileManager.default.removeItem(at: submissionMarkerURL)
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

/// What survives a restart after a report was accepted but not all of its photos were: the report reference, the
/// consent version and how many photos the server already holds. Never photo bytes, keys or assertions; the user
/// chooses the photos again, and the report itself is never resent.
nonisolated struct ReportPhotoFollowUp: Codable, Equatable, Sendable {
    let reportId: String
    let acceptedTermsVersion: String
    /// The parent's 90-day deadline less the 24-hour erasure window (docs/API.md), estimated from `receivedAt`.
    /// The server stays authoritative: a later upload is answered 410 either way.
    let uploadDeadline: Date
    var uploadedCount: Int

    init(reportId: String, acceptedTermsVersion: String, receivedAt: String, now: Date = Date(), uploadedCount: Int = 0) {
        self.reportId = reportId
        self.acceptedTermsVersion = acceptedTermsVersion
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let received = formatter.date(from: receivedAt) ?? ISO8601DateFormatter().date(from: receivedAt) ?? now
        uploadDeadline = received.addingTimeInterval(89 * 24 * 60 * 60)
        self.uploadedCount = uploadedCount
    }

    func isExpired(at now: Date = Date()) -> Bool { now >= uploadDeadline }
}

nonisolated protocol ReportPhotoFollowUpStoring: Sendable {
    func load() throws -> ReportPhotoFollowUp?
    func save(_ followUp: ReportPhotoFollowUp) throws
    func delete() throws
}

nonisolated struct FileReportPhotoFollowUpStore: ReportPhotoFollowUpStoring {
    let fileURL: URL

    init(directory: URL) {
        fileURL = directory.appending(path: "photo-follow-up.json")
    }

    func load() throws -> ReportPhotoFollowUp? {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }
        return try JSONDecoder().decode(ReportPhotoFollowUp.self, from: Data(contentsOf: fileURL))
    }

    func save(_ followUp: ReportPhotoFollowUp) throws {
        let directory = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                attributes: [.protectionKey: FileProtectionType.complete])
        try JSONEncoder().encode(followUp).write(to: fileURL, options: [.atomic, .completeFileProtection])
    }

    func delete() throws {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return }
        try FileManager.default.removeItem(at: fileURL)
    }
}
