import Foundation

/// One-shot authorization for one report submission. Ephemeral: held in memory for a single POST.
nonisolated struct ReportAuthorization: Equatable, Sendable {
    let keyId: String
    let challenge: String
    let assertion: Data
}

nonisolated enum ReportAuthorizationError: Error, Equatable, Sendable {
    /// DCAppAttestService is not supported on this device.
    case unsupported
    /// Apple's service or ours was unreachable, or answered unexpectedly; no report was sent.
    case temporarilyUnavailable
    /// Key generation, attestation or registration definitively failed.
    case registrationFailed
    case challengeLimited(Int?)
    /// The deployment does not accept this build (`detail: bundleVersion`).
    case updateRequired
    /// 503 attestationUnavailable: the deployment cannot take reports now.
    case serviceUnavailable
    case busy
}

nonisolated protocol ReportAuthorizing: Sendable {
    func isSupported() async -> Bool
    /// Returns an assertion over exactly `payload`, registering a key first when there is none.
    func authorize(payload: Data) async throws -> ReportAuthorization
    /// Applies a definite 403 from the final POST to local key state (never retries by itself).
    func handleRejection(_ rejection: AttestationRejection, keyId: String) async
}

/// Serializes all App Attest key state. Recovery is bounded per call: at most one new key and at
/// most one key-level recovery, so no failure mode can loop through generate/register.
actor AppAttestReportAuthorizer: ReportAuthorizing {
    private let device: any AppAttestDevice
    private let server: any AppAttestServer
    private let store: any AppAttestKeyStoring
    private var inFlight = false
    private var keyGenerationsRemaining = 0

    init(device: any AppAttestDevice, server: any AppAttestServer, store: any AppAttestKeyStoring) {
        self.device = device
        self.server = server
        self.store = store
    }

    func isSupported() -> Bool { device.isSupported }

    func authorize(payload: Data) async throws -> ReportAuthorization {
        guard device.isSupported else { throw ReportAuthorizationError.unsupported }
        guard !inFlight else { throw ReportAuthorizationError.busy }
        inFlight = true
        keyGenerationsRemaining = 1
        defer { inFlight = false }

        var keyRecoveryUsed = false
        while true {
            let keyId = try await registeredKey()
            guard let keyBytes = Data(base64Encoded: keyId) else { throw ReportAuthorizationError.registrationFailed }
            let challenge: String
            do { challenge = try await server.requestChallenge(.report(keyId: keyId)) }
            catch ReportAPIError.attestationRejected(let rejection) where rejection.reason == .keyNotRegistered {
                // The server holds no such key and Apple will not attest this key again.
                try discardKey()
                guard !keyRecoveryUsed else { throw ReportAuthorizationError.registrationFailed }
                keyRecoveryUsed = true
                continue
            } catch { throw Self.map(error) }
            guard let challengeBytes = Data(base64Encoded: challenge) else {
                throw ReportAuthorizationError.temporarilyUnavailable
            }
            let hash = AppAttestBinding.reportClientDataHash(challenge: challengeBytes, keyId: keyBytes, payload: payload)
            do {
                let assertion = try await device.generateAssertion(keyId, clientDataHash: hash)
                return ReportAuthorization(keyId: keyId, challenge: challenge, assertion: assertion)
            } catch AppAttestDeviceError.invalidKey {
                // The Secure Enclave key is gone or rejected (e.g. reinstall, migration, restore).
                try discardKey()
                guard !keyRecoveryUsed else { throw ReportAuthorizationError.registrationFailed }
                keyRecoveryUsed = true
            } catch { throw ReportAuthorizationError.temporarilyUnavailable }
        }
    }

    func handleRejection(_ rejection: AttestationRejection, keyId: String) {
        guard (try? store.load())??.keyId == keyId else { return }
        switch rejection.reason {
        case .challengeInvalid, .counterNotIncreasing:
            return // The key is fine; the next explicit submit fetches a new challenge.
        case .keyNotRegistered, .assertionInvalid, .attestationInvalid:
            // Apple refuses to attest a key twice, so a key the server does not hold or no longer
            // accepts cannot be re-registered: the next explicit submit generates a new one.
            try? discardKey()
        }
    }

    /// Advances the persisted key state until a key is registered. Each step persists before the
    /// next remote call, so an interrupted registration resumes with the same key.
    private func registeredKey() async throws -> String {
        for _ in 0..<4 {
            let state: AppAttestKeyState?
            do { state = try store.load() } catch {
                try discardKey()
                state = nil
            }
            switch state {
            case .registered(let keyId):
                return keyId
            case nil:
                guard keyGenerationsRemaining > 0 else { throw ReportAuthorizationError.registrationFailed }
                keyGenerationsRemaining -= 1
                let generated: String
                do { generated = try await device.generateKey() }
                catch { throw ReportAuthorizationError.registrationFailed }
                guard let keyId = Self.canonicalKeyID(generated) else { throw ReportAuthorizationError.registrationFailed }
                try persist(.generated(keyId: keyId))
            case .generated(let keyId):
                let challenge = try await registrationChallenge()
                guard let keyBytes = Data(base64Encoded: keyId), let challengeBytes = Data(base64Encoded: challenge) else {
                    throw ReportAuthorizationError.registrationFailed
                }
                let hash = AppAttestBinding.registrationClientDataHash(challenge: challengeBytes, keyId: keyBytes)
                let attestation: Data
                do { attestation = try await device.attestKey(keyId, clientDataHash: hash) }
                catch AppAttestDeviceError.serverUnavailable {
                    throw ReportAuthorizationError.temporarilyUnavailable // Apple: retry later, same key.
                } catch {
                    try discardKey() // Apple: for any other error, discard the key identifier.
                    throw ReportAuthorizationError.registrationFailed
                }
                try persist(.attested(keyId: keyId, attestationObject: attestation))
                try await register(keyId: keyId, challenge: challenge, attestation: attestation)
            case .attested(let keyId, let attestation):
                // An earlier registration answer was lost or refused as challengeInvalid. Present
                // the same attestation with a NEW challenge: 409 means it was registered; otherwise
                // verification fails (nonceMismatch) and the key is discarded.
                try await register(keyId: keyId, challenge: try await registrationChallenge(), attestation: attestation)
            }
        }
        throw ReportAuthorizationError.registrationFailed
    }

    private func register(keyId: String, challenge: String, attestation: Data) async throws {
        do {
            try await server.registerKey(keyId: keyId, challenge: challenge, attestationObject: attestation)
            try persist(.registered(keyId: keyId))
        } catch ReportAPIError.attestationRejected(let rejection) {
            switch rejection.reason {
            case .challengeInvalid:
                return // Nothing was stored; the loop reconciles with a fresh challenge.
            default:
                try discardKey()
                if rejection.requiresAppUpdate { throw ReportAuthorizationError.updateRequired }
                // attestationInvalid: the loop may generate one replacement key within this call.
            }
        } catch ReportAPIError.rejected(503, _) {
            throw ReportAuthorizationError.serviceUnavailable
        } catch ReportAPIError.rejected {
            try discardKey()
            throw ReportAuthorizationError.registrationFailed
        } catch {
            // Transport-ambiguous: keep `.attested` so the next attempt reconciles this same key.
            throw ReportAuthorizationError.temporarilyUnavailable
        }
    }

    private func registrationChallenge() async throws -> String {
        do { return try await server.requestChallenge(.registration) }
        catch { throw Self.map(error) }
    }

    private func persist(_ state: AppAttestKeyState) throws {
        do { try store.save(state) } catch { throw ReportAuthorizationError.registrationFailed }
    }

    private func discardKey() throws {
        do { try store.clear() } catch { throw ReportAuthorizationError.registrationFailed }
    }

    private static func map(_ error: Error) -> ReportAuthorizationError {
        switch error {
        case ReportAPIError.challengeLimited(let seconds): .challengeLimited(seconds)
        case ReportAPIError.rejected(503, _): .serviceUnavailable
        case let error as ReportAuthorizationError: error
        default: .temporarilyUnavailable
        }
    }

    /// DCAppAttestService returns standard base64 of 32 bytes; the server wants it canonical.
    private static func canonicalKeyID(_ value: String) -> String? {
        guard let bytes = Data(base64Encoded: value), bytes.count == 32 else { return nil }
        return bytes.base64EncodedString()
    }
}
