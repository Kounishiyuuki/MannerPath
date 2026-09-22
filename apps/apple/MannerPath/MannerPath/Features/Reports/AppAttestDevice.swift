@preconcurrency import DeviceCheck
import Foundation

/// Why the device-side App Attest call failed, reduced to what the recovery policy acts on.
nonisolated enum AppAttestDeviceError: Error, Equatable, Sendable {
    /// Apple's App Attest service was unreachable during attestKey: retry later with the same key.
    case serverUnavailable
    /// The key is unusable (already attested, never attested, rejected or gone, e.g. after a
    /// reinstall or restore): discard its identifier.
    case invalidKey
    case failed
}

/// The only boundary to DCAppAttestService. Tests inject a fake; nothing else calls DeviceCheck.
nonisolated protocol AppAttestDevice: Sendable {
    var isSupported: Bool { get }
    /// Returns the key identifier as DCAppAttestService reports it (base64 text).
    func generateKey() async throws -> String
    func attestKey(_ keyId: String, clientDataHash: Data) async throws -> Data
    func generateAssertion(_ keyId: String, clientDataHash: Data) async throws -> Data
}

nonisolated struct SystemAppAttestDevice: AppAttestDevice {
    var isSupported: Bool { DCAppAttestService.shared.isSupported }

    func generateKey() async throws -> String {
        do { return try await DCAppAttestService.shared.generateKey() }
        catch { throw Self.map(error) }
    }

    func attestKey(_ keyId: String, clientDataHash: Data) async throws -> Data {
        do { return try await DCAppAttestService.shared.attestKey(keyId, clientDataHash: clientDataHash) }
        catch { throw Self.map(error) }
    }

    func generateAssertion(_ keyId: String, clientDataHash: Data) async throws -> Data {
        do { return try await DCAppAttestService.shared.generateAssertion(keyId, clientDataHash: clientDataHash) }
        catch { throw Self.map(error) }
    }

    private static func map(_ error: Error) -> AppAttestDeviceError {
        switch (error as? DCError)?.code {
        case .serverUnavailable: .serverUnavailable
        case .invalidKey: .invalidKey
        default: .failed
        }
    }
}

/// The locally persisted App Attest key, which is not the report installId and is never derived
/// from or sent with it.
nonisolated enum AppAttestKeyState: Codable, Equatable, Sendable {
    /// generateKey succeeded; attestKey has not (yet) produced an attestation object.
    case generated(keyId: String)
    /// attestKey succeeded but the server's registration answer was not seen. Apple refuses to
    /// attest a key twice, so the attestation object is kept to reconcile with a fresh challenge:
    /// the server answers 409 for an already-registered key before it verifies anything.
    case attested(keyId: String, attestationObject: Data)
    case registered(keyId: String)

    var keyId: String {
        switch self {
        case .generated(let keyId), .attested(let keyId, _), .registered(let keyId): keyId
        }
    }
}

nonisolated protocol AppAttestKeyStoring: Sendable {
    func load() throws -> AppAttestKeyState?
    func save(_ state: AppAttestKeyState) throws
    func clear() throws
}

/// A protected file in Application Support, excluded from backup. Apple recommends a file for the
/// key identifier; the Secure Enclave key does not survive reinstall, migration or restore, so a
/// copy of the identifier that did (a Keychain item survives reinstall; a backup survives restore)
/// would only name a key that no longer exists.
nonisolated struct FileAppAttestKeyStore: AppAttestKeyStoring {
    let fileURL: URL

    init(directory: URL) {
        fileURL = directory.appending(path: "key-state.json")
    }

    func load() throws -> AppAttestKeyState? {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }
        return try JSONDecoder().decode(AppAttestKeyState.self, from: Data(contentsOf: fileURL))
    }

    func save(_ state: AppAttestKeyState) throws {
        let directory = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                attributes: [.protectionKey: FileProtectionType.complete])
        try JSONEncoder().encode(state).write(to: fileURL, options: [.atomic, .completeFileProtection])
        var url = fileURL
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try url.setResourceValues(values)
    }

    func clear() throws {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return }
        try FileManager.default.removeItem(at: fileURL)
    }
}
