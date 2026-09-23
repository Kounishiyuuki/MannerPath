import CryptoKit
import Foundation

/// The byte-level binding between an App Attest signature and what it authorizes, exactly as
/// docs/API.md "App Attest client data" and ADR-0007 §6 define it; pinned by
/// contracts/app-attest/client-data-vectors.v1.json.
nonisolated enum AppAttestBinding {
    static let registrationDomain = "mannerpath.app-attest.registration.v1"
    static let reportDomain = "mannerpath.app-attest.report.v1"

    /// frame(x) = uint32 big-endian byte length of x ‖ x, for every part in order.
    static func clientData(domain: String, parts: [Data]) -> Data {
        var data = Data()
        for part in [Data(domain.utf8)] + parts {
            var length = UInt32(part.count).bigEndian
            withUnsafeBytes(of: &length) { data.append(contentsOf: $0) }
            data.append(part)
        }
        return data
    }

    static func registrationClientDataHash(challenge: Data, keyId: Data) -> Data {
        Data(SHA256.hash(data: clientData(domain: registrationDomain, parts: [challenge, keyId])))
    }

    /// `payload` must be the very bytes whose base64 travels in the submission's `payload` field.
    static func reportClientDataHash(challenge: Data, keyId: Data, payload: Data) -> Data {
        Data(SHA256.hash(data: clientData(domain: reportDomain, parts: [challenge, keyId, payload])))
    }
}
