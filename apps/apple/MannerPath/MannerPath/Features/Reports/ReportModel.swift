import Foundation
import Observation

nonisolated enum ReportSubmissionState: Equatable, Sendable {
    case idle
    case submitting
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
    private var retryAllowedAt: Date?
    private var acceptedCleanupPending = false
    private var recoveredSubmissionAttempt = false

    private(set) var availability: ReportAvailability = .unknown
    private(set) var draft: ReportDraft?
    private(set) var submission: ReportSubmissionState = .idle
    private(set) var cleanupError: String?
    var canRetryAmbiguous: Bool { submission == .ambiguous && !recoveredSubmissionAttempt }

    var retryAfterSecondsRemaining: Int? {
        guard let retryAllowedAt else { return nil }
        return max(0, Int(ceil(retryAllowedAt.timeIntervalSinceNow)))
    }

    init(configClient: any ReportConfigFetching, reportClient: any ReportSubmitting,
         store: any ReportDraftStoring, installIDs: any InstallIDProviding) {
        self.configClient = configClient
        self.reportClient = reportClient
        self.store = store
        self.installIDs = installIDs
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
            submission = .failed("Saved report could not be read safely.")
        }
    }

    func refreshAvailability() async {
        do { availability = try await configClient.fetchAvailability() }
        catch { availability = .unknown }
    }

    func start(type: ReportType, spotId: String?) {
        guard !acceptedCleanupPending, !recoveredSubmissionAttempt,
              submission != .submitting, draft == nil else { return }
        let newDraft = ReportDraft(type: type, spotId: type == .missing ? nil : spotId)
        saveDraft(newDraft)
    }

    func saveDraft(_ updated: ReportDraft) {
        guard !acceptedCleanupPending, !recoveredSubmissionAttempt,
              submission != .submitting else { return }
        var updated = updated
        updated.proposedLocation = updated.proposedLocation?.quantized
        do {
            try store.save(updated)
            draft = updated
            if submission != .ambiguous { submission = .idle }
        } catch {
            if submission != .ambiguous { submission = .failed("Report could not be saved on this device.") }
        }
    }

    func cancel() {
        guard !acceptedCleanupPending, submission != .submitting else { return }
        do {
            try store.delete()
            try store.clearAcceptedCleanupMarker()
            draft = nil
            recoveredSubmissionAttempt = false
            submission = .idle
        } catch { submission = .failed("Saved report could not be removed.") }
    }

    func submit() async {
        guard !acceptedCleanupPending, !recoveredSubmissionAttempt,
              submission != .submitting, submission != .ambiguous,
              (retryAfterSecondsRemaining ?? 0) == 0,
              case .available(let limits) = availability, let draft else { return }
        let body: Data
        do { body = try ReportRequest.encoded(draft: draft, installId: installIDs.installID(), limits: limits) }
        catch let error as ReportValidationError {
            submission = .failed(Self.validationMessage(error))
            return
        } catch {
            submission = .failed("Report could not be prepared.")
            return
        }
        do { try store.markSubmissionAttempt() }
        catch {
            submission = .failed("Report could not be safely prepared on this device.")
            return
        }
        submission = .submitting
        do {
            let accepted = try await reportClient.submit(body)
            self.draft = nil
            submission = .accepted(accepted)
            acceptedCleanupPending = true
            do { try store.markAcceptedForCleanup() }
            catch { cleanupError = "Report was received, but its local draft could not be removed." }
            retryAcceptedCleanup()
        } catch let error as ReportAPIError {
            switch error {
            case .rejected(let status, let code):
                guard clearDefiniteAttempt() else { return }
                if status == 503 && code == "attestationUnavailable" { availability = .unavailable }
                submission = .rejected(code.map { "\(status): \($0)" } ?? "Server rejected the report (\(status)).")
            case .rateLimited(let seconds):
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
            cleanupError = "Report was received, but its local draft could not be removed."
        }
    }

    private static func validationMessage(_ error: ReportValidationError) -> String {
        switch error {
        case .missingSpotID: "Choose an existing place before submitting."
        case .unexpectedSpotID: "A missing-place suggestion cannot include an existing place."
        case .missingProposedLocation: "Choose and confirm a proposed map pin."
        case .unexpectedProposedLocation: "This report type cannot include a proposed pin."
        case .invalidCoordinate: "Choose a valid point on the map."
        case .invalidObservedDay: "Choose a valid observation day."
        case .emptyNote: "Remove the empty note or add some detail."
        case .noteTooLong: "Shorten the note to the server's character limit."
        case .bodyTooLarge: "Shorten the note to fit the server's request size limit."
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
        return ReportModel(configClient: client, reportClient: client,
                           store: FileReportDraftStore(directory: directory.appending(path: "Reports", directoryHint: .isDirectory)),
                           installIDs: UserDefaultsInstallID())
    }
}
