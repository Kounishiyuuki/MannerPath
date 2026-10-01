import Foundation

nonisolated enum ReportType: String, CaseIterable, Codable, Sendable {
    case exists, missing, moved, hoursChanged, tobaccoTypeChanged, accessChanged, prohibited, other
    // ADR-0013 structured findings; sent only to a deployment that advertises `existingSpotFindings`.
    case notFound, removed, typeChanged

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
        case .notFound: String(localized: "I couldn't find it")
        case .removed: String(localized: "It has been removed")
        case .typeChanged: String(localized: "It's a different kind of place")
        }
    }

    var needsProposedLocation: Bool { self == .missing || self == .moved }

    /// Types an older deployment's strict schema would reject.
    var isExistingSpotFinding: Bool { self == .notFound || self == .removed || self == .typeChanged }

    /// The structured corrections offered on an existing place, in the order the detail menu shows them.
    static func corrections(acceptsFindings: Bool) -> [ReportType] {
        let all: [ReportType] = [.notFound, .removed, .moved, .typeChanged, .accessChanged, .hoursChanged,
                                 .tobaccoTypeChanged, .prohibited, .other]
        return all.filter { acceptsFindings || !$0.isExistingSpotFinding }
    }
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

/// The report terms documents this build can show (docs/legal/, Issue #124). Each version is bundled as
/// `Terms/<version>.md`, byte-identical to the repository document (services/api test/community-activation.test.ts),
/// so the full text shown is exactly what consent records. A deployment whose /v1/config names a version this build
/// does not bundle cannot receive informed consent from it: the report entry point asks for an app update instead.
/// The community activation PR adds the approved version here (docs/legal/COMMUNITY_PUBLICATION_DECISION.md §8).
nonisolated enum ReportTerms {
    struct Document: Equatable, Sendable {
        let version: String
        /// A draft awaiting legal/maintainer approval: nothing is published on consent to it, and the sheet says so.
        let isDraft: Bool
    }

    static let documents: [Document] = [
        Document(version: "report-terms.2026-09-30.draft", isDraft: true),
    ]

    static func document(for version: String) -> Document? {
        documents.first { $0.version == version }
    }

    /// The bundled full text of a version, or nil when this build does not carry it.
    static func fullText(for version: String, in bundle: Bundle = .main) -> String? {
        guard document(for: version) != nil,
              let url = bundle.url(forResource: version, withExtension: "md") else { return nil }
        return try? String(contentsOf: url, encoding: .utf8)
    }
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

/// ADR-0013: what an existing-spot correction proposes instead (docs/API.md `claim` on typeChanged / accessChanged /
/// tobaccoTypeChanged). Categorical wire strings only; `nil` means "not stated".
nonisolated struct ReportCorrection: Codable, Equatable, Sendable {
    var spotType: String? = nil
    var spotSubtype: String? = nil
    var accessType: String? = nil
    var accessDetail: String? = nil
    var supportsPaper: String? = nil
    var supportsHeated: String? = nil
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
    /// ADR-0013 correction claim of an existing-spot report. Drafts saved earlier decode with nil.
    var correction: ReportCorrection? = nil

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
    /// Whether the deployment accepts the ADR-0013 finding types and correction claims.
    var acceptsExistingSpotFindings = false
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
    case unexpectedClaim, invalidClaim, unsupportedReportType, invalidCorrection
}

/// The `claim` member on the wire: a new-spot claim or an existing-spot correction, never both.
nonisolated enum ReportClaimPayload: Encodable, Sendable {
    case newSpot(ReportClaim)
    case correction(ReportCorrection)

    func encode(to encoder: any Encoder) throws {
        switch self {
        case .newSpot(let claim): try claim.encode(to: encoder)
        case .correction(let correction): try correction.encode(to: encoder)
        }
    }
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
    let claim: ReportClaimPayload?

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
        if draft.type.isExistingSpotFinding && !limits.acceptsExistingSpotFindings { throw ReportValidationError.unsupportedReportType }
        // A correction travels only on its own report type, only to a deployment that accepts it; to an older one the
        // report goes without it (the note can still say it).
        if let correction = draft.correction, !isValid(correction, for: draft.type) { throw ReportValidationError.invalidCorrection }
        let claimPayload: ReportClaimPayload? = if let claim = draft.claim, limits.acceptsNewSpotClaim {
            .newSpot(claim)
        } else if let correction = draft.correction, limits.acceptsExistingSpotFindings {
            .correction(correction)
        } else {
            nil
        }
        let request = Self(schemaVersion: limits.submissionProtocol.schemaVersion, type: draft.type, spotId: draft.spotId,
                           proposedLocation: draft.proposedLocation?.quantized,
                           observedOn: draft.observedOn, note: draft.note, installId: installId,
                           acceptedTermsVersion: limits.termsVersion,
                           claim: claimPayload)
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

    /// The server's per-type correction shapes (services/api/src/reports/dto.ts).
    private static func isValid(_ c: ReportCorrection, for type: ReportType) -> Bool {
        switch type {
        case .typeChanged:
            guard let spotType = c.spotType, c.accessType == nil, c.accessDetail == nil,
                  c.supportsPaper == nil, c.supportsHeated == nil else { return false }
            return !(c.spotSubtype != nil && spotType == "unknown")
        case .accessChanged:
            guard let access = c.accessType, c.spotType == nil, c.spotSubtype == nil,
                  c.supportsPaper == nil, c.supportsHeated == nil else { return false }
            return c.accessDetail == nil || access == "facilityOnly"
        case .tobaccoTypeChanged:
            return c.spotType == nil && c.spotSubtype == nil && c.accessType == nil && c.accessDetail == nil
                && (c.supportsPaper != nil || c.supportsHeated != nil)
        default:
            return false
        }
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
