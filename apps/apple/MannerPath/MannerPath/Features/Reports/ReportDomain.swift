import Foundation

nonisolated enum ReportType: String, CaseIterable, Codable, Sendable {
    case exists, missing, moved, hoursChanged, tobaccoTypeChanged, accessChanged, prohibited, other

    var title: String {
        switch self {
        case .exists: String(localized: "This place exists")
        case .missing: String(localized: "Suggest a missing place")
        case .moved: String(localized: "This place moved")
        case .hoursChanged: String(localized: "Hours changed")
        case .tobaccoTypeChanged: String(localized: "Supported tobacco types changed")
        case .accessChanged: String(localized: "Access changed")
        case .prohibited: String(localized: "Smoking is prohibited here")
        case .other: String(localized: "Other correction")
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

/// The report terms document this build shows (docs/legal/REPORT_TERMS_DRAFT.md, Issue #124). A deployment that
/// publishes another version in /v1/config cannot receive valid consent from this build.
nonisolated enum ReportTerms {
    static let bundledVersion = "report-terms.2026-09-30.draft"
    /// The bundled document is a draft awaiting legal/maintainer approval; the sheet says so.
    static let isDraft = true
}

/// What a new-spot report states about the place (ADR-0012, docs/API.md `claim`). Values are wire strings; `nil`
/// means "not stated". The place type is the one required answer: a shop or café alone is not a smoking place.
nonisolated struct ReportClaim: Codable, Equatable, Sendable {
    var spotType: String = "unknown"
    var spotSubtype: String? = nil
    var accessType: String? = nil
    var accessDetail: String? = nil
    var hostType: String? = nil
    var environment: String? = nil
    var supportsPaper: String? = nil
    var supportsHeated: String? = nil
    var hostName: String? = nil
    var hoursNote: String? = nil

    static let hostNameMaxLength = 80
    static let hoursNoteMaxLength = 120
}

nonisolated struct ReportDraft: Codable, Equatable, Sendable {
    var type: ReportType
    var spotId: String?
    var subjectName: String?
    var proposedLocation: ReportCoordinate?
    var observedOn: String?
    var note: String?
    /// The terms version the user explicitly agreed to for this draft; nil until they do. Drafts saved by an
    /// earlier build decode with nil, so consent is never assumed.
    var acceptedTermsVersion: String?
    /// ADR-0012 structured claim; only a `missing` report carries one. Drafts saved earlier decode with nil.
    var claim: ReportClaim? = nil

    init(type: ReportType, spotId: String? = nil, subjectName: String? = nil,
         proposedLocation: ReportCoordinate? = nil,
         observedOn: String? = nil, note: String? = nil, acceptedTermsVersion: String? = nil) {
        self.type = type
        self.spotId = spotId
        self.subjectName = subjectName
        self.proposedLocation = proposedLocation
        self.observedOn = observedOn
        self.note = note
        self.acceptedTermsVersion = acceptedTermsVersion
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
    /// The report terms version the deployment records consent to; nil for a deployment that predates terms.
    var termsVersion: String? = nil
    /// Whether the deployment accepts `claim` on a new-spot report; its strict schema rejects it otherwise.
    var acceptsNewSpotClaim = false
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
    case invalidCoordinate, invalidObservedDay, emptyNote, noteTooLong, bodyTooLarge, termsNotAccepted
    case unexpectedClaim, invalidClaim
}

nonisolated struct ReportRequest: Encodable, Sendable {
    let schemaVersion: Int
    let type: ReportType
    let spotId: String?
    let proposedLocation: ReportCoordinate?
    let observedOn: String?
    let note: String?
    let installId: UUID
    /// Inside the payload, so for schemaVersion 2 the App Attest assertion signs the consent too.
    let acceptedTermsVersion: String?
    let claim: ReportClaim?

    enum CodingKeys: String, CodingKey {
        case schemaVersion, type, spotId, proposedLocation, observedOn, note, installId, acceptedTermsVersion, claim
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
        // A deployment that records consent gets it explicitly, for exactly its version; one that predates terms
        // is never sent the field (its strict schema would reject it).
        if let required = limits.termsVersion {
            guard draft.acceptedTermsVersion == required else { throw ReportValidationError.termsNotAccepted }
        }
        // The claim travels only on a new-spot report, and only to a deployment that accepts it.
        if draft.claim != nil && draft.type != .missing { throw ReportValidationError.unexpectedClaim }
        if let claim = draft.claim, limits.acceptsNewSpotClaim, !isValid(claim) { throw ReportValidationError.invalidClaim }
        let request = Self(schemaVersion: limits.submissionProtocol.schemaVersion, type: draft.type, spotId: draft.spotId,
                           proposedLocation: draft.proposedLocation?.quantized,
                           observedOn: draft.observedOn, note: draft.note, installId: installId,
                           acceptedTermsVersion: limits.termsVersion,
                           claim: limits.acceptsNewSpotClaim ? draft.claim : nil)
        let data = try JSONEncoder().encode(request)
        guard data.count <= limits.maxBodyBytes else { throw ReportValidationError.bodyTooLarge }
        return data
    }

    /// The server's refinement rules, checked before sending so a user is not told only "invalid report".
    private static func isValid(_ claim: ReportClaim) -> Bool {
        if claim.spotSubtype != nil && claim.spotType == "unknown" { return false }
        if claim.accessDetail != nil && claim.accessType != "facilityOnly" { return false }
        if let name = claim.hostName, name.isEmpty || name.count > ReportClaim.hostNameMaxLength { return false }
        if let hours = claim.hoursNote, hours.isEmpty || hours.count > ReportClaim.hoursNoteMaxLength { return false }
        return true
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
