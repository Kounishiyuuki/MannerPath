import Foundation
import CryptoKit
import Observation

nonisolated enum ReportSubmissionState: Equatable, Sendable {
    case idle
    /// Registering a key, fetching a challenge and signing: nothing has been sent to POST /reports.
    case preparingSecureSubmission
    case submitting
    /// A definite App Attest refusal, or a local failure to obtain authorization. No report was
    /// stored; submitting again obtains fresh authorization.
    case authorizationFailed(String)
    case accepted(AcceptedReport)
    case rejected(String)
    case rateLimited(Int?)
    case ambiguous
    case idempotencyConflict
    case idempotencyRetired
    case attestationOwnerChanged
    case failed(String)
}

/// The terms version the user last agreed to on this device, so a one-tap confirmation can show "agreed to version X"
/// instead of asking again for the same document. Only an explicit toggle records it; a different version is never
/// treated as agreed.
nonisolated protocol ReportConsentRemembering: Sendable {
    func agreedVersion() -> String?
    func remember(_ version: String?)
}

nonisolated struct UserDefaultsReportConsent: ReportConsentRemembering {
    private static let key = "reportTermsAgreedVersion"
    func agreedVersion() -> String? { UserDefaults.standard.string(forKey: Self.key) }
    func remember(_ version: String?) { UserDefaults.standard.set(version, forKey: Self.key) }
}

@MainActor @Observable
final class ReportModel {
    let photos: ReportPhotos
    private let configClient: any ReportConfigFetching
    private let reportClient: any ReportSubmitting
    private let store: any ReportDraftStoring
    private let installIDs: any InstallIDProviding
    private let attestedClient: (any AttestedReportSubmitting)?
    private let authorizer: (any ReportAuthorizing)?
    private let consent: (any ReportConsentRemembering)?
    private var retryAllowedAt: Date?
    private var acceptedCleanupPending = false
    private var recoveredSubmissionAttempt = false
    private let photoFollowUps: (any ReportPhotoFollowUpStoring)?

    /// A report received earlier (possibly in a previous launch) whose photos are not all on the server yet.
    private(set) var photoFollowUp: ReportPhotoFollowUp?
    /// The follow-up exists only in memory: closing the app now would lose the way back to this report's photos.
    private(set) var photoFollowUpNotSaved = false

    private(set) var availability: ReportAvailability = .unknown
    private(set) var draft: ReportDraft?
    private(set) var submission: ReportSubmissionState = .idle
    private(set) var cleanupError: String?
    var usesIdempotentRetry: Bool { draft?.pendingSubmission?.schemaVersion == 3 }
    var canEditDraft: Bool { !isBusy && draft?.pendingSubmission == nil && !recoveredSubmissionAttempt }
    var isTerminalReceipt: Bool {
        submission == .idempotencyConflict || submission == .idempotencyRetired || submission == .attestationOwnerChanged
    }
    var canRetryAmbiguous: Bool {
        guard submission == .ambiguous, !recoveredSubmissionAttempt, !ambiguousRetryNeedsPhotos else { return false }
        if usesIdempotentRetry {
            guard case .available(let limits) = availability else { return false }
            return limits.submissionProtocol == .appAttestV3
        }
        return true
    }
    /// v1.0 accepts new-place proposals without photos whenever reporting is available (scope change 2026-11-02:
    /// photos on Workers Free were NO-GO). The terms and an explicitly confirmed pin are still required, and the
    /// deployment's App Attest protocol applies unchanged (never downgraded; see refreshAvailability).
    var acceptsNewSpotProposals: Bool {
        guard case .available = availability else { return false }
        return true
    }

    /// Photo evidence (planned for v1.1) is active only while the deployment advertises photo intake and this build
    /// carries consent for the same terms version. Then a new-place proposal is sent only together with photos, as
    /// before; otherwise no photo is asked for, chosen or sent.
    var acceptsPhotoEvidence: Bool {
        guard case .available(let limits) = availability else { return false }
        return limits.acceptsPhotoEvidence && photos.accepts(termsVersion: limits.termsVersion)
    }

    /// Read-only preflight for the form. Uses the wire validator without generating/storing an identity,
    /// fixing a payload, authorizing or sending anything. The actual submit path still validates independently.
    var submissionReadinessMessage: String? {
        guard case .available(let limits) = availability, var candidate = draft else { return nil }
        if candidate.type == .missing && !acceptsNewSpotProposals {
            return String(localized: "New smoking places are not being accepted right now.")
        }
        // Locked retries must keep their original encoded payload; their dedicated retry UI owns readiness.
        guard candidate.pendingSubmission == nil else { return nil }
        if limits.submissionProtocol == .appAttestV3, candidate.idempotencyKey == nil {
            candidate.idempotencyKey = String(repeating: "0", count: 64)
        }
        do {
            _ = try ReportRequest.encoded(draft: candidate,
                installId: UUID(uuidString: "00000000-0000-4000-8000-000000000000")!, limits: limits)
        } catch let error as ReportValidationError {
            return Self.validationMessage(error)
        } catch {
            return String(localized: "Report could not be prepared.")
        }
        if candidate.type == .missing && acceptsPhotoEvidence && photos.photos.isEmpty {
            return String(localized: "Add at least one photo of the smoking place to submit.")
        }
        return nil
    }

    /// Photos live only in memory: after a restart, a saved new-place submission is retried only once the user has
    /// chosen its photos again, so the report is never accepted without photos to follow it.
    var ambiguousRetryNeedsPhotos: Bool { draft?.type == .missing && acceptsPhotoEvidence && photos.photos.isEmpty }

    /// A submission is in progress: preparing authorization counts, the draft must not change.
    var isBusy: Bool { submission == .submitting || submission == .preparingSecureSubmission || photos.busy }

    var retryAfterSecondsRemaining: Int? {
        guard let retryAllowedAt else { return nil }
        return max(0, Int(ceil(retryAllowedAt.timeIntervalSinceNow)))
    }

    init(configClient: any ReportConfigFetching, reportClient: any ReportSubmitting,
         store: any ReportDraftStoring, installIDs: any InstallIDProviding,
         attestedClient: (any AttestedReportSubmitting)? = nil,
         authorizer: (any ReportAuthorizing)? = nil,
         consent: (any ReportConsentRemembering)? = nil,
         photoPolicy: PhotoEvidencePolicy = PhotoEvidencePolicy(),
         photoUploader: (any EvidencePhotoUploading)? = nil,
         photoFollowUps: (any ReportPhotoFollowUpStoring)? = nil) {
        photos = ReportPhotos(policy: photoPolicy, uploader: photoUploader)
        self.photoFollowUps = photoFollowUps
        self.consent = consent
        self.configClient = configClient
        self.reportClient = reportClient
        self.store = store
        self.installIDs = installIDs
        self.attestedClient = attestedClient
        self.authorizer = authorizer
        do {
            switch try store.submissionMarker() {
            case .accepted:
                acceptedCleanupPending = true
                retryAcceptedCleanup()
            case .attempted:
                recoveredSubmissionAttempt = true
                draft = try store.load()
                if draft == nil {
                    try store.clearAcceptedCleanupMarker()
                    recoveredSubmissionAttempt = false
                } else {
                    if let saved = draft, Self.validPendingSubmission(saved), saved.pendingSubmission?.ownerKeyHash != nil {
                        recoveredSubmissionAttempt = false
                        submission = Self.recoveredState(saved)
                    } else {
                        submission = .ambiguous
                    }
                }
            case nil:
                if var saved = try store.load() {
                    if saved.pendingSubmission != nil {
                        guard Self.validPendingSubmission(saved) else { throw CocoaError(.fileReadCorruptFile) }
                        submission = Self.recoveredState(saved)
                    } else if let pin = saved.proposedLocation, pin != pin.quantized {
                        saved.proposedLocation = pin.quantized
                        try store.save(saved)
                    }
                    draft = saved
                }
            }
        } catch {
            recoveredSubmissionAttempt = true
            submission = .failed(String(localized: "Saved report could not be read safely."))
        }
        photos.onProgress = { [weak self] in self?.recordPhotoProgress() }
        // An unreadable record only loses the chance to re-attach photos; it never blocks reporting.
        if let saved = try? photoFollowUps?.load() {
            photoFollowUp = saved
            if saved.isExpired() {
                // Kept in memory only, to say once that the time ended; nothing is left to send.
                try? photoFollowUps?.delete()
            } else {
                photos.resume(reportID: saved.reportId, acceptedTermsVersion: saved.acceptedTermsVersion,
                              alreadyUploaded: saved.uploadedCount)
            }
        }
    }

    /// An unexpired earlier report still waits for photos: a new report would discard that chance, so none starts.
    var hasPendingPhotoFollowUp: Bool { photoFollowUp.map { !$0.isExpired() } ?? false }

    /// Whether an earlier report's photos can still be sent from this device.
    var canResumePhotos: Bool {
        guard let photoFollowUp, !photoFollowUp.isExpired() else { return false }
        return photos.resumed && photos.acceptedReportID == photoFollowUp.reportId && !photos.closedForPhotos
    }

    /// The user stops adding photos (or the time ran out): the received report stays as it is.
    func endPhotoFollowUp() {
        guard !photos.busy else { return }
        try? photoFollowUps?.delete()
        photoFollowUp = nil
        photoFollowUpNotSaved = false
        photos.clear()
    }

    private func recordPhotoProgress() {
        guard var followUp = photoFollowUp, photos.acceptedReportID == followUp.reportId else { return }
        if photos.allUploaded || photos.closedForPhotos {
            try? photoFollowUps?.delete()
            photoFollowUp = nil
            photoFollowUpNotSaved = false
            return
        }
        followUp.uploadedCount = photos.totalUploaded
        photoFollowUp = followUp
        do {
            try photoFollowUps?.save(followUp)
            photoFollowUpNotSaved = false
        } catch { photoFollowUpNotSaved = true }
    }

    /// The protocol comes from /v1/config alone. A deployment that requires App Attest on a device
    /// that cannot produce it is unavailable — never downgraded to the unattested version.
    func refreshAvailability() async {
        do {
            let fetched = try await configClient.fetchAvailability()
            if case .available(let limits) = fetched, limits.submissionProtocol.isAttested {
                guard let authorizer, attestedClient != nil, await authorizer.isSupported() else {
                    availability = .attestationUnsupported
                    return
                }
            }
            availability = fetched
        } catch { availability = .unknown }
    }

    func start(type: ReportType, spotId: String?, subjectName: String? = nil) {
        guard canStartReport else { return }
        photoFollowUp = nil
        photos.clear()
        let newDraft = ReportDraft(type: type, spotId: type == .missing ? nil : spotId,
                                   subjectName: type == .missing ? nil : subjectName)
        saveDraft(newDraft)
    }

    /// Whether a new report can be started right now (one draft at a time, nothing in flight).
    var canStartReport: Bool { !acceptedCleanupPending && !recoveredSubmissionAttempt && !isBusy && draft == nil && !hasPendingPhotoFollowUp }

    /// ADR-0013 "add a smoking place": a new-spot draft, optionally with a pin the user already placed on the map.
    func startNewSpot(pin: ReportCoordinate?) {
        guard canStartReport else { return }
        photoFollowUp = nil
        photos.clear()
        var newDraft = ReportDraft(type: .missing, proposedLocation: pin?.quantized)
        newDraft.claim = ReportClaim()
        saveDraft(newDraft)
    }

    /// ADR-0013 one-tap "still here": an `exists` draft with no free text. Agreement to the terms carries over only for
    /// the exact version the user agreed to before; otherwise the confirmation sheet asks.
    func startQuickConfirm(spotId: String, subjectName: String?) {
        guard canStartReport else { return }
        photoFollowUp = nil
        photos.clear()
        var newDraft = ReportDraft(type: .exists, spotId: spotId, subjectName: subjectName)
        if case .available(let limits) = availability, let version = limits.termsVersion, consent?.agreedVersion() == version {
            newDraft.acceptedTermsVersion = version
        }
        saveDraft(newDraft)
    }

    /// "Is it one of these?": the user picked an existing nearby place instead of adding a new one. The new-spot draft
    /// becomes a still-here confirmation of that place; consent stays as given, the pin and claim are dropped.
    func confirmExistingInstead(spotId: String, subjectName: String?) {
        guard canEditDraft, var current = draft, current.type == .missing else { return }
        current = ReportDraft(type: .exists, spotId: spotId, subjectName: subjectName,
                              acceptedTermsVersion: current.acceptedTermsVersion)
        saveDraft(current)
    }

    func saveDraft(_ updated: ReportDraft) {
        guard !acceptedCleanupPending, canEditDraft else { return }
        var updated = updated
        updated.proposedLocation = updated.proposedLocation?.quantized
        do {
            try store.save(updated)
            draft = updated
            if submission != .ambiguous { submission = .idle }
        } catch {
            if submission != .ambiguous { submission = .failed(String(localized: "Report could not be saved on this device.")) }
        }
    }

    /// Records (or withdraws) the user's explicit agreement to the terms version this deployment shows. Only the
    /// current version can be agreed to; there is no consent without an available deployment that names one.
    func setTermsAccepted(_ accepted: Bool) {
        guard canEditDraft, case .available(let limits) = availability, let version = limits.termsVersion, var edited = draft else { return }
        edited.acceptedTermsVersion = accepted ? version : nil
        saveDraft(edited)
        consent?.remember(accepted ? version : nil)
    }

    func cancel() {
        guard !acceptedCleanupPending, !isBusy else { return }
        do {
            try store.delete()
            try store.clearAcceptedCleanupMarker()
            draft = nil
            photos.clear()
            recoveredSubmissionAttempt = false
            submission = .idle
        } catch { submission = .failed(String(localized: "Saved report could not be removed.")) }
    }

    func submit() async {
        guard !acceptedCleanupPending, !recoveredSubmissionAttempt, !isBusy,
              submission != .ambiguous, !isTerminalReceipt,
              (retryAfterSecondsRemaining ?? 0) == 0,
              case .available(let limits) = availability, var draft else { return }
        if draft.type == .missing {
            guard acceptsNewSpotProposals else {
                submission = .failed(String(localized: "New smoking places are not being accepted right now."))
                return
            }
            guard !acceptsPhotoEvidence || !photos.photos.isEmpty else {
                submission = .failed(String(localized: "Add at least one photo of the smoking place to submit."))
                return
            }
            guard draft.acceptedTermsVersion == limits.termsVersion else {
                submission = .failed(Self.validationMessage(.termsNotAccepted))
                return
            }
        }
        // One encoding, one immutable payload: these exact bytes are both hashed into the
        // assertion and base64-encoded into the envelope.
        let payload: Data
        do {
            if let pending = draft.pendingSubmission {
                guard limits.submissionProtocol == .appAttestV3, Self.validPendingSubmission(draft),
                      pending.payload.count <= limits.maxBodyBytes else {
                    submission = .failed(String(localized: "Saved report could not be read safely."))
                    return
                }
                payload = pending.payload
            } else {
                if limits.submissionProtocol == .appAttestV3, draft.idempotencyKey == nil {
                    draft.idempotencyKey = ReportIdempotencyKey.generate()
                }
                payload = try ReportRequest.encoded(draft: draft, installId: installIDs.installID(), limits: limits)
                if limits.submissionProtocol == .appAttestV3 {
                    draft.pendingSubmission = ReportPendingSubmission(schemaVersion: 3, payload: payload)
                    // Persist one protected atomic draft before authorization or POST. A restart uses the same
                    // payload/key, but never persists or reuses a challenge or assertion.
                    try store.save(draft)
                    self.draft = draft
                }
            }
        }
        catch let error as ReportValidationError {
            submission = .failed(Self.validationMessage(error))
            return
        } catch {
            submission = .failed(String(localized: "Report could not be prepared."))
            return
        }

        var body = payload
        var authorizedKeyID: String?
        if limits.submissionProtocol.isAttested {
            guard let authorizer, attestedClient != nil else {
                availability = .attestationUnsupported
                return
            }
            submission = .preparingSecureSubmission
            let authorization: ReportAuthorization
            do { authorization = try await authorizer.authorize(payload: payload) }
            catch let error as ReportAuthorizationError {
                applyAuthorizationFailure(error)
                return
            } catch {
                submission = .authorizationFailed(String(localized: "This report could not be secured. Try again later."))
                return
            }
            authorizedKeyID = authorization.keyId
            if limits.submissionProtocol == .appAttestV3 {
                guard let owner = Self.ownerFingerprint(authorization.keyId) else {
                    submission = .authorizationFailed(String(localized: "This report could not be secured. Try again later."))
                    return
                }
                if let previous = draft.pendingSubmission?.ownerKeyHash, previous != owner {
                    recordTerminalReceipt("attestationOwnerChanged", state: .attestationOwnerChanged)
                    return
                }
                if draft.pendingSubmission?.ownerKeyHash == nil {
                    draft.pendingSubmission?.ownerKeyHash = owner
                    do {
                        // Bind ownership atomically before recording an attempt or sending any report.
                        try store.save(draft)
                        self.draft = draft
                    } catch {
                        submission = .failed(String(localized: "Report could not be safely prepared on this device."))
                        return
                    }
                }
            }
            do { body = try AttestedReportEnvelope.encoded(payload: payload, authorization: authorization,
                                                         schemaVersion: limits.submissionProtocol.schemaVersion) }
            catch {
                submission = .authorizationFailed(String(localized: "This report could not be secured. Try again later."))
                return
            }
            guard body.count <= (limits.maxSubmissionBytes ?? limits.maxBodyBytes) else {
                submission = .failed(Self.validationMessage(.bodyTooLarge))
                return
            }
        }

        do { try store.markSubmissionAttempt() }
        catch {
            submission = .failed(String(localized: "Report could not be safely prepared on this device."))
            return
        }
        submission = .submitting
        do {
            let accepted = limits.submissionProtocol.isAttested
                ? try await attestedClient!.submitAttested(body)
                : try await reportClient.submit(body)
            self.draft = nil
            submission = .accepted(accepted)
            acceptedCleanupPending = true
            do { try store.markAcceptedForCleanup() }
            catch { cleanupError = String(localized: "Report was received, but its local draft could not be removed.") }
            retryAcceptedCleanup()
            if !photos.photos.isEmpty, let version = draft.acceptedTermsVersion, photos.accepts(termsVersion: version) {
                // Written before the first photo is sent, so a restart mid-upload can still re-attach photos to
                // this report. Failing to write it only loses that recovery, which the form then says.
                let followUp = ReportPhotoFollowUp(reportId: accepted.reportId, acceptedTermsVersion: version,
                                                   receivedAt: accepted.receivedAt)
                photoFollowUp = followUp
                do { try photoFollowUps?.save(followUp) } catch { photoFollowUpNotSaved = true }
            }
            await photos.attach(to: accepted.reportId, acceptedTermsVersion: draft.acceptedTermsVersion)
        } catch let error as ReportAPIError {
            switch error {
            case .idempotencyConflict:
                recordTerminalReceipt("idempotencyConflict", state: .idempotencyConflict)
            case .idempotencyRetired:
                // Final v3 contract: an owned retired receipt is already handled. Drop this draft/key;
                // do not manufacture a fresh key or repeat the report to recover expired content.
                submission = .idempotencyRetired
                self.draft = nil
                acceptedCleanupPending = true
                do { try store.markAcceptedForCleanup() }
                catch { cleanupError = String(localized: "The expired submission's saved draft could not be removed.") }
                retryAcceptedCleanup()
            case .rejected(let status, let code):
                guard clearDefiniteAttempt() else { return }
                if status == 503 && code == "attestationUnavailable" { availability = .unavailable }
                if status == 409 && code == "termsVersionOutdated" { availability = .incompatible }
                submission = .rejected(Self.rejectionMessage(status: status, code: code))
            case .rateLimited(let seconds):
                guard clearDefiniteAttempt() else { return }
                retryAllowedAt = seconds.map { Date().addingTimeInterval(TimeInterval($0)) }
                submission = .rateLimited(seconds)
            case .attestationRejected(let rejection):
                // Definite (docs/API.md): nothing stored, no counter moved. Never resubmitted here.
                guard clearDefiniteAttempt() else { return }
                if let authorizedKeyID, let authorizer {
                    await authorizer.handleRejection(rejection, keyId: authorizedKeyID)
                }
                // `detail: bundleVersion` is about the build, not the key: reporting is closed
                // until the app is updated, so no further submit can churn a new key.
                if rejection.requiresAppUpdate { availability = .incompatible }
                submission = .authorizationFailed(Self.rejectionMessage(rejection))
            case .challengeLimited(let seconds):
                guard clearDefiniteAttempt() else { return }
                retryAllowedAt = seconds.map { Date().addingTimeInterval(TimeInterval($0)) }
                submission = .rateLimited(seconds)
            case .incompatibleResponse: submission = .ambiguous
            case .malformedResponse, .httpStatus: submission = .ambiguous
            }
        } catch {
            submission = .ambiguous
        }
    }

    func retryAmbiguous() async {
        guard canRetryAmbiguous else { return }
        submission = .idle
        await submit()
    }

    private func clearDefiniteAttempt() -> Bool {
        do {
            try store.clearAcceptedCleanupMarker()
            return true
        } catch {
            recoveredSubmissionAttempt = true
            submission = .ambiguous
            return false
        }
    }

    private func recordTerminalReceipt(_ code: String, state: ReportSubmissionState) {
        guard var saved = draft, saved.pendingSubmission != nil else {
            submission = .ambiguous
            return
        }
        saved.pendingSubmission?.terminalFailure = code
        do {
            try store.save(saved)
            draft = saved
            submission = state
        } catch {
            submission = .ambiguous
        }
    }

    private static func recoveredState(_ draft: ReportDraft) -> ReportSubmissionState {
        switch draft.pendingSubmission?.terminalFailure {
        case "idempotencyConflict": .idempotencyConflict
        case "idempotencyRetired": .idempotencyRetired
        case "attestationOwnerChanged": .attestationOwnerChanged
        default: .ambiguous
        }
    }

    private static func validPendingSubmission(_ draft: ReportDraft) -> Bool {
        guard let pending = draft.pendingSubmission, pending.schemaVersion == 3,
              pending.terminalFailure == nil || ["idempotencyConflict", "idempotencyRetired", "attestationOwnerChanged"].contains(pending.terminalFailure!),
              pending.ownerKeyHash == nil || ReportIdempotencyKey.isValid(pending.ownerKeyHash),
              let key = draft.idempotencyKey, ReportIdempotencyKey.isValid(key),
              let object = try? JSONSerialization.jsonObject(with: pending.payload) as? [String: Any],
              object["schemaVersion"] as? Int == 3, object["idempotencyKey"] as? String == key,
              let installID = object["installId"] as? String, UUID(uuidString: installID) != nil else { return false }
        return true
    }

    private static func ownerFingerprint(_ keyID: String) -> String? {
        guard let bytes = Data(base64Encoded: keyID), bytes.count == 32,
              bytes.base64EncodedString() == keyID else { return nil }
        return SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }

    func retryAcceptedCleanup() {
        guard acceptedCleanupPending else { return }
        do {
            try store.delete()
            try store.clearAcceptedCleanupMarker()
            acceptedCleanupPending = false
            cleanupError = nil
        } catch {
            cleanupError = submission == .idempotencyRetired
                ? String(localized: "The expired submission's saved draft could not be removed.")
                : String(localized: "Report was received, but its local draft could not be removed.")
        }
    }

    /// Nothing was sent to POST /reports, so the draft stays submittable and no marker was written.
    private func applyAuthorizationFailure(_ error: ReportAuthorizationError) {
        submission = .idle
        switch error {
        case .unsupported:
            availability = .attestationUnsupported
        case .serviceUnavailable:
            availability = .unavailable
        case .challengeLimited(let seconds):
            retryAllowedAt = seconds.map { Date().addingTimeInterval(TimeInterval($0)) }
            submission = .rateLimited(seconds)
        case .updateRequired:
            availability = .incompatible
        case .registrationFailed:
            submission = .authorizationFailed(String(localized: "This device could not be registered for secure reporting. Try again later."))
        case .temporarilyUnavailable, .busy:
            submission = .authorizationFailed(String(localized: "Secure submission is temporarily unavailable. Try again later."))
        }
    }

    private static func rejectionMessage(_ rejection: AttestationRejection) -> String {
        rejection.requiresAppUpdate
            ? String(localized: "Update the app to submit reports.")
            : String(localized: "The security check for this report did not pass. Nothing was submitted; you can try again.")
    }

    private static func validationMessage(_ error: ReportValidationError) -> String {
        switch error {
        case .invalidIdempotencyKey: String(localized: "Saved report could not be read safely.")
        case .missingSpotID: String(localized: "Choose an existing place before submitting.")
        case .unexpectedSpotID: String(localized: "A missing-place suggestion cannot include an existing place.")
        case .missingProposedLocation: String(localized: "Choose and confirm a proposed map pin.")
        case .unexpectedProposedLocation: String(localized: "This report type cannot include a proposed pin.")
        case .invalidCoordinate: String(localized: "Choose a valid point on the map.")
        case .invalidObservedDay: String(localized: "Choose a valid observation day.")
        case .emptyNote: String(localized: "Remove the empty note or add some detail.")
        case .noteTooLong: String(localized: "Shorten the note to the character limit.")
        case .bodyTooLarge: String(localized: "Shorten the note and try again.")
        case .termsNotAccepted: String(localized: "Read and agree to the report terms before submitting.")
        case .unexpectedClaim: String(localized: "Place details can only be added to a missing-place suggestion.")
        case .invalidClaim: String(localized: "Check the place details: a detail must match the type or access you chose, and text must fit its limit.")
        case .unsupportedReportType: String(localized: "This kind of report isn't available yet. Choose another report type or use Other correction.")
        case .invalidCorrection: String(localized: "Check the correction: choose the value you saw, or remove it.")
        }
    }

    private static func rejectionMessage(status: Int, code: String?) -> String {
        switch (status, code) {
        case (503, "attestationUnavailable"):
            String(localized: "Reporting is temporarily unavailable. Your draft remains saved.")
        case (409, "termsVersionOutdated"):
            String(localized: "The report terms have changed. Update the app to read them. Your draft remains saved.")
        case (400, _):
            String(localized: "Some report information needs to be corrected.")
        case (413, _):
            String(localized: "The report is too long. Shorten the additional detail and try again.")
        default:
            String(localized: "The report could not be accepted. Your draft remains saved.")
        }
    }
}

private nonisolated struct UnconfiguredReportClient: ReportConfigFetching, ReportSubmitting {
    func fetchAvailability() async throws -> ReportAvailability { .unknown }
    func submit(_ body: Data) async throws -> AcceptedReport { throw ReportAPIError.httpStatus(503) }
}

@MainActor
enum ReportComposition {
    static func makeModel() -> ReportModel {
        #if DEBUG
        if let scenario = UserDefaults.standard.string(forKey: "uiTestPhotoReport") {
            return UITestPhotoReportStack.makeModel(scenario: scenario)
        }
        #endif
        let client: any ReportConfigFetching & ReportSubmitting
        if let baseURL = NearbyComposition.apiBaseURL {
            client = ReportAPIClient(baseURL: baseURL)
        } else {
            client = UnconfiguredReportClient()
        }
        let directory = (try? FileManager.default.url(for: .applicationSupportDirectory,
                                                       in: .userDomainMask, appropriateFor: nil,
                                                       create: true))
            ?? URL(fileURLWithPath: NSHomeDirectory()).appending(path: "Library/Application Support", directoryHint: .isDirectory)
        let authorizer = (client as? ReportAPIClient).map {
            AppAttestReportAuthorizer(device: SystemAppAttestDevice(), server: $0,
                                      store: FileAppAttestKeyStore(directory: directory.appending(path: "AppAttest", directoryHint: .isDirectory)))
        }
        return ReportModel(configClient: client, reportClient: client,
                           store: FileReportDraftStore(directory: directory.appending(path: "Reports", directoryHint: .isDirectory)),
                           installIDs: UserDefaultsInstallID(),
                           attestedClient: client as? ReportAPIClient,
                           authorizer: authorizer,
                           consent: UserDefaultsReportConsent(),
                           // Photo intake stays closed until a photo terms version is reviewed on both sides
                           // (PhotoEvidencePolicy.reviewedPhotoTerms); the uploader shares the report's App Attest key.
                           photoPolicy: .reviewed(),
                           photoUploader: (client as? ReportAPIClient).flatMap { api in
                               authorizer.map { AttestedEvidencePhotoUploader(baseURL: api.baseURL, authorizer: $0) }
                           },
                           photoFollowUps: FileReportPhotoFollowUpStore(directory: directory.appending(path: "Reports", directoryHint: .isDirectory)))
    }
}
