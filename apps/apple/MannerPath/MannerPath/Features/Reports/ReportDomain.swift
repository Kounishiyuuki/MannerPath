import Foundation

nonisolated enum ReportType: String, CaseIterable, Codable, Sendable {
    case exists, missing, moved, hoursChanged, tobaccoTypeChanged, accessChanged, prohibited, other

    var title: String {
        switch self {
        case .exists: "This place exists"
        case .missing: "Suggest a missing place"
        case .moved: "This place moved"
        case .hoursChanged: "Hours changed"
        case .tobaccoTypeChanged: "Supported tobacco types changed"
        case .accessChanged: "Access changed"
        case .prohibited: "Smoking is prohibited here"
        case .other: "Other correction"
        }
    }

    var needsProposedLocation: Bool { self == .missing || self == .moved }
}

nonisolated struct ReportCoordinate: Codable, Equatable, Sendable {
    var latitude: Double
    var longitude: Double

    var isValid: Bool {
        latitude.isFinite && longitude.isFinite && (-90...90).contains(latitude) && (-180...180).contains(longitude)
    }

    var quantized: Self {
        Self(latitude: (latitude * 100_000).rounded() / 100_000,
             longitude: (longitude * 100_000).rounded() / 100_000)
    }
}

nonisolated struct ReportDraft: Codable, Equatable, Sendable {
    var type: ReportType
    var spotId: String?
    var proposedLocation: ReportCoordinate?
    var observedOn: String?
    var note: String?

    init(type: ReportType, spotId: String? = nil, proposedLocation: ReportCoordinate? = nil,
         observedOn: String? = nil, note: String? = nil) {
        self.type = type
        self.spotId = spotId
        self.proposedLocation = proposedLocation
        self.observedOn = observedOn
        self.note = note
    }
}

/// The one report protocol a deployment accepts, chosen from /v1/config and never inferred.
nonisolated enum ReportProtocol: Equatable, Sendable {
    /// schemaVersion 1, no attestation.
    case unattested
    /// schemaVersion 2: exact payload bytes plus an App Attest assertion over them.
    case appAttest

    var schemaVersion: Int { self == .unattested ? 1 : 2 }
}

nonisolated struct ReportLimits: Equatable, Sendable {
    let noteMaxLength: Int
    let maxBodyBytes: Int
    var submissionProtocol: ReportProtocol = .unattested
    /// The whole request body limit; for schemaVersion 1 it equals `maxBodyBytes`.
    var maxSubmissionBytes: Int? = nil
}

nonisolated enum ReportAvailability: Equatable, Sendable {
    case unknown
    case unavailable
    case incompatible
    /// The deployment requires App Attest and this device cannot produce it. Never downgraded.
    case attestationUnsupported
    case available(ReportLimits)
}

nonisolated enum ReportValidationError: Error, Equatable, Sendable {
    case missingSpotID, unexpectedSpotID, missingProposedLocation, unexpectedProposedLocation
    case invalidCoordinate, invalidObservedDay, emptyNote, noteTooLong, bodyTooLarge
}

nonisolated struct ReportRequest: Encodable, Sendable {
    let schemaVersion: Int
    let type: ReportType
    let spotId: String?
    let proposedLocation: ReportCoordinate?
    let observedOn: String?
    let note: String?
    let installId: UUID

    enum CodingKeys: String, CodingKey {
        case schemaVersion, type, spotId, proposedLocation, observedOn, note, installId
    }

    /// Encodes once. For schemaVersion 2 the returned bytes are the payload that is both hashed
    /// into the assertion and base64-encoded into the envelope; never re-encode the draft.
    static func encoded(draft: ReportDraft, installId: UUID, limits: ReportLimits) throws -> Data {
        if draft.type == .missing {
            guard draft.spotId == nil else { throw ReportValidationError.unexpectedSpotID }
        } else {
            guard let spotId = draft.spotId, !spotId.isEmpty else { throw ReportValidationError.missingSpotID }
        }
        if draft.type.needsProposedLocation {
            guard let pin = draft.proposedLocation else { throw ReportValidationError.missingProposedLocation }
            guard pin.isValid else { throw ReportValidationError.invalidCoordinate }
        } else if draft.proposedLocation != nil {
            throw ReportValidationError.unexpectedProposedLocation
        }
        if let observed = draft.observedOn, !isValidDay(observed) {
            throw ReportValidationError.invalidObservedDay
        }
        if let note = draft.note {
            guard !note.isEmpty else { throw ReportValidationError.emptyNote }
            guard note.utf16.count <= limits.noteMaxLength else { throw ReportValidationError.noteTooLong }
        }
        let request = Self(schemaVersion: limits.submissionProtocol.schemaVersion, type: draft.type, spotId: draft.spotId,
                           proposedLocation: draft.proposedLocation?.quantized,
                           observedOn: draft.observedOn, note: draft.note, installId: installId)
        let data = try JSONEncoder().encode(request)
        guard data.count <= limits.maxBodyBytes else { throw ReportValidationError.bodyTooLarge }
        return data
    }

    private static func isValidDay(_ value: String) -> Bool {
        guard value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else { return false }
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.isLenient = false
        guard let date = formatter.date(from: value) else { return false }
        return formatter.string(from: date) == value
    }
}

/// POST /v1/reports schemaVersion 2 (docs/API.md). App Attest material exists only here, in memory,
/// for one request; it is never written to the draft store.
nonisolated struct AttestedReportEnvelope: Encodable, Sendable {
    struct Attestation: Encodable, Sendable {
        let keyId: String
        let challenge: String
        let assertion: String
    }

    let schemaVersion = 2
    let payload: String
    let attestation: Attestation

    enum CodingKeys: String, CodingKey { case schemaVersion, payload, attestation }

    static func encoded(payload: Data, authorization: ReportAuthorization) throws -> Data {
        let envelope = Self(payload: payload.base64EncodedString(),
                            attestation: .init(keyId: authorization.keyId, challenge: authorization.challenge,
                                               assertion: authorization.assertion.base64EncodedString()))
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        return try encoder.encode(envelope)
    }
}

nonisolated struct AcceptedReport: Decodable, Equatable, Sendable {
    let schemaVersion: Int
    let reportId: String
    let state: String
    let receivedAt: String
}
