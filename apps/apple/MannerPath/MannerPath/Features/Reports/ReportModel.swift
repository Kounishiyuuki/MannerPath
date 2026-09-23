import Foundation
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
    case failed(String)
}

@MainActor @Observable
final class ReportModel {
    private let configClient: any ReportConfigFetching
    private let reportClient: any ReportSubmitting
    private let store: any ReportDraftStoring
    private let installIDs: any InstallIDProviding
    private let attestedClient: (any AttestedReportSubmitting)?
    private let authorizer: (any ReportAuthorizing)?
    private var retryAllowedAt: Date?
    private var acceptedCleanupPending = false
    private var recoveredSubmissionAttempt = false

    private(set) var availability: ReportAvailability = .unknown
    private(set) var draft: ReportDraft?
    private(set) var submission: ReportSubmissionState = .idle
    private(set) var cleanupError: String?
    var canRetryAmbiguous: Bool { submission == .ambiguous && !recoveredSubmissionAttempt }
    /// A submission is in progress: preparing authorization counts, the draft must not change.
    var isBusy: Bool { submission == .submitting || submission == .preparingSecureSubmission }

    var retryAfterSecondsRemaining: Int? {
        guard let retryAllowedAt else { return nil }
        return max(0, Int(ceil(retryAllowedAt.timeIntervalSinceNow)))
    }

    init(configClient: any ReportConfigFetching, reportClient: any ReportSubmitting,
         store: any ReportDraftStoring, installIDs: any InstallIDProviding,
         attestedClient: (any AttestedReportSubmitting)? = nil,
         authorizer: (any ReportAuthorizing)? = nil) {
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
                    submission = .ambiguous
                }
            case nil:
                if var saved = try store.load() {
                    if let pin = saved.proposedLocation, pin != pin.quantized {
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
    }

    /// The protocol comes from /v1/config alone. A deployment that requires App Attest on a device
    /// that cannot produce it is unavailable — never downgraded to the unattested version.
    func refreshAvailability() async {
        do {
            let fetched = try await configClient.fetchAvailability()
            if case .available(let limits) = fetched, limits.submissionProtocol == .appAttest {
                guard let authorizer, attestedClient != nil, await authorizer.isSupported() else {
                    availability = .attestationUnsupported
                    return
                }
            }
            availability = fetched
        } catch { availability = .unknown }
    }

    func start(type: ReportType, spotId: String?, subjectName: String? = nil) {
        guard !acceptedCleanupPending, !recoveredSubmissionAttempt, !isBusy, draft == nil else { return }
        let newDraft = ReportDraft(type: type, spotId: type == .missing ? nil : spotId,
                                   subjectName: type == .missing ? nil : subjectName)
        saveDraft(newDraft)
    }

    func saveDraft(_ updated: ReportDraft) {
        guard !acceptedCleanupPending, !recoveredSubmissionAttempt, !isBusy else { return }
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

    func cancel() {
        guard !acceptedCleanupPending, !isBusy else { return }
        do {
            try store.delete()
            try store.clearAcceptedCleanupMarker()
            draft = nil
            recoveredSubmissionAttempt = false
            submission = .idle
        } catch { submission = .failed(String(localized: "Saved report could not be removed.")) }
    }

    func submit() async {
        guard !acceptedCleanupPending, !recoveredSubmissionAttempt, !isBusy,
              submission != .ambiguous,
              (retryAfterSecondsRemaining ?? 0) == 0,
              case .available(let limits) = availability, let draft else { return }
        // One encoding, one immutable payload: these exact bytes are both hashed into the
        // assertion and base64-encoded into the envelope.
        let payload: Data
        do { payload = try ReportRequest.encoded(draft: draft, installId: installIDs.installID(), limits: limits) }
        catch let error as ReportValidationError {
            submission = .failed(Self.validationMessage(error))
            return
        } catch {
            submission = .failed(String(localized: "Report could not be prepared."))
            return
        }

        var body = payload
        var authorizedKeyID: String?
        if limits.submissionProtocol == .appAttest {
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
            do { body = try AttestedReportEnvelope.encoded(payload: payload, authorization: authorization) }
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
            let accepted = limits.submissionProtocol == .appAttest
                ? try await attestedClient!.submitAttested(body)
                : try await reportClient.submit(body)
            self.draft = nil
            submission = .accepted(accepted)
            acceptedCleanupPending = true
            do { try store.markAcceptedForCleanup() }
            catch { cleanupError = String(localized: "Report was received, but its local draft could not be removed.") }
            retryAcceptedCleanup()
        } catch let error as ReportAPIError {
            switch error {
            case .rejected(let status, let code):
                guard clearDefiniteAttempt() else { return }
                if status == 503 && code == "attestationUnavailable" { availability = .unavailable }
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

    func retryAcceptedCleanup() {
        guard acceptedCleanupPending else { return }
        do {
            try store.delete()
            try store.clearAcceptedCleanupMarker()
            acceptedCleanupPending = false
            cleanupError = nil
        } catch {
            cleanupError = String(localized: "Report was received, but its local draft could not be removed.")
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
        case .missingSpotID: String(localized: "Choose an existing place before submitting.")
        case .unexpectedSpotID: String(localized: "A missing-place suggestion cannot include an existing place.")
        case .missingProposedLocation: String(localized: "Choose and confirm a proposed map pin.")
        case .unexpectedProposedLocation: String(localized: "This report type cannot include a proposed pin.")
        case .invalidCoordinate: String(localized: "Choose a valid point on the map.")
        case .invalidObservedDay: String(localized: "Choose a valid observation day.")
        case .emptyNote: String(localized: "Remove the empty note or add some detail.")
        case .noteTooLong: String(localized: "Shorten the note to the character limit.")
        case .bodyTooLarge: String(localized: "Shorten the note and try again.")
        }
    }

    private static func rejectionMessage(status: Int, code: String?) -> String {
        switch (status, code) {
        case (503, "attestationUnavailable"):
            String(localized: "Reporting is temporarily unavailable. Your draft remains saved.")
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
                           authorizer: authorizer)
    }
}
