import MapKit
import SwiftUI

struct ReportFormView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Bindable var model: ReportModel
    let visualCenter: SpotCoordinate?
    /// Places already on the map near the user, for "is it one of these?" before adding a new one (ADR-0013).
    var nearbySpots: [Spot] = []
    /// Opened from a new-report entry while an earlier report still waits for photos: ask before anything changes.
    var opensWithFollowUpChoice = false
    /// The device's current fix, offered in the pin picker only as a starting point the user then checks and confirms.
    var deviceLocation: ReportDeviceLocation = .denied
    var onRequestDeviceLocation: () -> Void = {}

    @State private var observedDate = Date()
    @State private var hasObservedDate = false
    @State private var choosingPin = false
    @State private var confirmingRetry = false
    @State private var showingTerms = false
    @State private var followUpChoiceMade = false
    @State private var confirmingNewReport = false
    @State private var confirmingDiscard = false
    @FocusState private var additionalDetailFocused: Bool

    private var isMissing: Bool { model.draft?.type == .missing }

    var body: some View {
        NavigationStack {
            Form {
                if choosingFollowUp, let followUp = model.photoFollowUp {
                    followUpChoice(followUp)
                }
                Section {
                    if isMissing {
                        Text("Know a smoking place missing from the map? Choose its location, add photos and tell us what you know. Approved information is added after review.")
                            .accessibilityIdentifier("report.newPlace.introduction")
                        Text("Location, 1–3 photos and agreement to the terms are required. Other details can stay unknown. Closing this form keeps your draft; photos stay only until the app closes.")
                            .font(.footnote).foregroundStyle(.secondary)
                    } else if model.draft != nil {
                        Text("This is a proposal for review. Submitting it does not immediately change the listing.")
                    }
                    // Said first, not only beside the hidden submit button: nothing here can be submitted right now.
                    if let unavailableNotice {
                        Label(unavailableNotice, systemImage: "info.circle")
                            .font(.footnote)
                            .accessibilityIdentifier("report-unavailable-notice")
                    }
                    if isMissing, case .available = model.availability, !model.acceptsNewSpotProposals {
                        Label("New smoking places are not being accepted right now.", systemImage: "pause.circle")
                            .font(.footnote)
                            .accessibilityIdentifier("report-new-spot-closed")
                    }
                    if model.usesIdempotentRetry {
                        Text("This saved submission is fixed for retry. To change it, discard this draft and start a separate report.")
                            .font(.footnote)
                    }
                }

                if let draft = model.draft {
                    Section("Report subject") {
                        Text(reportSubject(draft))
                            .font(.footnote)
                    }
                    if !isMissing {
                        Section("What needs review?") {
                            Picker("Report type", selection: Binding(
                                get: { draft.type },
                                set: { type in
                                    var edited = draft
                                    edited.type = type
                                    if type != .moved { edited.proposedLocation = nil }
                                    edited.correction = nil
                                    model.saveDraft(edited)
                                }
                            )) {
                                ForEach(ReportType.corrections(acceptsFindings: acceptsFindings) + [.exists], id: \.self) { type in
                                    Text(type.title).tag(type)
                                }
                            }
                            .disabled(!model.canEditDraft)
                        }
                    }

                    if draft.type == .moved || draft.type == .missing {
                        Section(isMissing ? "1. Choose the location (required)" : "Proposed place") {
                            Button(draft.proposedLocation == nil ? "Choose a map pin" : "Change proposed pin") {
                                choosingPin = true
                            }
                            .disabled(!model.canEditDraft)
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("report.pin.choose")
                            if let pin = draft.proposedLocation {
                                Label("Proposed map pin selected", systemImage: "mappin.and.ellipse")
                                    .font(.footnote).foregroundStyle(.secondary)
                                    .accessibilityValue("Latitude \(pin.latitude.formatted()), longitude \(pin.longitude.formatted())")
                            } else {
                                Text("Use your current location or choose the place on the map, then confirm it. Your location is never used unless you choose it.")
                                    .font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                    }

                    if isMissing {
                        Section {
                            if let pin = draft.proposedLocation {
                                let candidates = DuplicateCandidates.near(pin, in: nearbySpots)
                                if candidates.isEmpty {
                                    Text("No nearby match was found in the map data saved on this device. This is not a complete duplicate check.")
                                        .font(.footnote)
                                        .accessibilityIdentifier("report.duplicates.noMatch")
                                } else {
                                    Text("Is it one of these?")
                                        .font(.headline)
                                    ForEach(candidates, id: \.spot.id) { candidate in
                                        Button {
                                            model.confirmExistingInstead(spotId: candidate.spot.id, subjectName: SpotPresentation.name(candidate.spot))
                                        } label: {
                                            VStack(alignment: .leading, spacing: 2) {
                                                Text(SpotPresentation.name(candidate.spot))
                                                Text("About \(Int(candidate.distanceMeters.rounded())) m from your pin · tap to confirm it is still here instead")
                                                    .font(.footnote).foregroundStyle(.secondary)
                                            }
                                        }
                                        .disabled(!model.canEditDraft)
                                    }
                                }
                            } else {
                                Text("Choose a pin first to see nearby places already saved on this device.")
                                    .font(.footnote).foregroundStyle(.secondary)
                            }
                        } header: {
                            Text("2. Check for an existing place")
                        } footer: {
                            Text("Before adding a new place, check whether it is already listed. If it is a different place nearby, keep adding it.")
                        }
                    }

                    // New-place photos come before optional details. The deployment/consent gate is unchanged.
                    if isMissing, model.photos.enabled && model.acceptsNewSpotProposals {
                        ReportPhotoSection(photos: model.photos, required: true)
                            .disabled(isSubmitting)
                    }

                    if !isMissing, acceptsFindings, let kind = CorrectionKind(draft.type) {
                        CorrectionSection(kind: kind, correction: Binding(
                            get: { model.draft?.correction ?? ReportCorrection() },
                            set: { value in editDraft { $0.correction = value.isEmpty ? nil : value } }
                        ))
                        .disabled(!model.canEditDraft)
                    }

                    if isMissing, case .available(let limits) = model.availability, limits.acceptsNewSpotClaim {
                        NewSpotClaimSection(claim: Binding(
                            get: { model.draft?.claim ?? ReportClaim() },
                            set: { value in editDraft { $0.claim = value } }
                        ))
                        .disabled(!model.canEditDraft)
                    }

                    Section("When did you observe this? (optional)") {
                        Toggle("Add observation day", isOn: $hasObservedDate)
                            .disabled(!model.canEditDraft)
                            .onChange(of: hasObservedDate) { _, enabled in
                                editDraft { $0.observedOn = enabled ? Self.dayString(observedDate) : nil }
                            }
                        if hasObservedDate {
                            DatePicker("Day", selection: $observedDate, displayedComponents: .date)
                                .disabled(!model.canEditDraft)
                                .onChange(of: observedDate) { _, day in
                                    editDraft { $0.observedOn = Self.dayString(day) }
                                }
                        }
                    }

                    Section("Additional detail (optional)") {
                        TextEditor(text: Binding(
                            get: { model.draft?.note ?? "" },
                            set: { value in editDraft { $0.note = value.isEmpty ? nil : value } }
                        ))
                        .disabled(!model.canEditDraft)
                        .focused($additionalDetailFocused)
                        .frame(minHeight: 100)
                        .accessibilityLabel("Additional report detail")
                        if case .available(let limits) = model.availability {
                            Text("\(draft.note?.utf16.count ?? 0) / \(limits.noteMaxLength) text units (emoji may count as two)")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }

                    // Photos are offered only while the deployment accepts them; for a new place the notice above
                    // says why not. Chosen before consent and submit, which they gate.
                    if !isMissing, model.photos.enabled && model.acceptsNewSpotProposals {
                        ReportPhotoSection(photos: model.photos)
                            .disabled(isSubmitting)
                    }

                    if isMissing {
                        Section("5. Review before sending") {
                            Label(draft.proposedLocation == nil ? "Location still needed" : "Proposed map pin selected",
                                  systemImage: draft.proposedLocation == nil ? "circle" : "checkmark.circle")
                            LabeledContent("Photos chosen", value: "\(model.photos.photos.count) / 3")
                            Text("Review the location, photos and details above. You can leave information you do not know as unknown.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        .accessibilityIdentifier("report.review.summary")
                    }

                    if let version = termsVersion {
                        Section {
                            Button("Read the report terms") { showingTerms = true }
                            Toggle("I agree to the report terms", isOn: Binding(
                                get: { draft.acceptedTermsVersion == version },
                                set: { model.setTermsAccepted($0) }
                            ))
                            .disabled(!model.canEditDraft)
                        } header: {
                            Text(isMissing ? "Terms (required)" : "Report terms")
                        } footer: {
                            Text("Required before submitting. Terms version \(version)")
                        }
                    }

                    Section {
                        if usesScrollableRetryNotice { ambiguousNotice }
                        if case .available = model.availability {
                            if let message = model.submissionReadinessMessage, !isAmbiguous {
                                Label(message, systemImage: "info.circle")
                                    .font(.footnote)
                                    .accessibilityElement(children: .combine)
                                    .accessibilityIdentifier("report.readiness")
                            }
                            if !usesScrollableRetryNotice {
                                TimelineView(.periodic(from: .now, by: 1)) { _ in
                                    Button("Submit for review") { Task { await model.submit() } }
                                        .disabled(isSubmitting || isAccepted || isAmbiguous || model.isTerminalReceipt || !termsAccepted ||
                                                  newSpotNeedsPhotos || model.submissionReadinessMessage != nil ||
                                                  (model.retryAfterSecondsRemaining ?? 0) > 0)
                                        .frame(minHeight: 44)
                                        .accessibilityIdentifier("report.submit")
                                }
                            }
                            if isAmbiguous && model.ambiguousRetryNeedsPhotos {
                                Text("Photos are not kept on this device. Choose the photos again to retry this saved submission.")
                                    .font(.footnote)
                                    .accessibilityIdentifier("report-retry-needs-photos")
                            }

                        } else if case .attestationUnsupported = model.availability {
                            Text("Secure reporting isn't supported on this device. Your draft remains saved.")
                                .font(.footnote)
                        } else {
                            Text("Submission is unavailable until reporting availability can be confirmed. Your draft remains saved.")
                                .font(.footnote)
                        }
                    }
                }
                // After acceptance the draft is gone; its photos stay here until every one is sent or given up.
                // Also shown right after acceptance, so unsent photos never block a new report until a restart; the
                // explanation is only for a later launch, where the accepted status below is gone.
                if model.draft == nil, !choosingFollowUp, let followUp = model.photoFollowUp {
                    Section("Received report") {
                        if followUp.isExpired() {
                            Text("The time for adding photos to this report has ended.")
                                .accessibilityIdentifier("report-photo-follow-up-expired")
                        } else if model.photos.closedForPhotos {
                            Text("No more photos can be added to this report. The report itself was received.")
                        } else {
                            if case .idle = model.submission {
                                Text("This report was received, but not all of its photos were. Photos are not kept on this device, so choose them again to send them to the same report. The report itself will not be sent again.")
                                    .accessibilityIdentifier("report-photo-follow-up")
                                Text("Until a photo is received, a new place stays out of review for listing.")
                                    .font(.footnote).foregroundStyle(.secondary)
                                // A photo whose answer was lost may already be on the server; only confirmed ones count here.
                                LabeledContent("Photos confirmed as received", value: "\(model.photos.totalUploaded) / \(model.photos.maxAttachments)")
                                Text("A photo sent just before the app closed may already have been received without being confirmed here. It counts toward the limit of 3.")
                                    .font(.footnote).foregroundStyle(.secondary)
                            }
                            if photoIntakePaused {
                                Label("Photo intake is paused. This report keeps waiting for photos; try again later.", systemImage: "pause.circle")
                                    // One element: icon and text are read together and found by one identifier.
                                    .accessibilityElement(children: .combine)
                                    .accessibilityIdentifier("report-photo-intake-paused")
                            }
                            if model.photoFollowUpNotSaved {
                                Label("This report could not be saved for adding photos later. Keep the app open until the photos are sent; if it closes, they cannot be added to this report.", systemImage: "exclamationmark.triangle")
                                    // One element: icon and text are read together and found by one identifier.
                                    .accessibilityElement(children: .combine)
                                    .accessibilityIdentifier("report-photo-follow-up-not-saved")
                            }
                        }
                        if case .idle = model.submission {
                            LabeledContent("Report reference", value: followUp.reportId)
                                .textSelection(.enabled)
                        }
                        Button(followUp.isExpired() ? "Dismiss" : "Stop adding photos", role: followUp.isExpired() ? nil : .destructive) {
                            model.endPhotoFollowUp()
                            dismiss()
                        }
                        .disabled(model.photos.busy)
                        .accessibilityIdentifier("report.photo.endFollowUp")
                    }
                }
                if model.draft == nil, !choosingFollowUp, model.photos.enabled, !model.photos.photos.isEmpty || model.canResumePhotos {
                    ReportPhotoSection(photos: model.photos)
                }
                Section { status }
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                if isAccepted {
                    receivedHeading
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding()
                        .background(.bar)
                } else if isAmbiguous && !usesScrollableRetryNotice {
                    ambiguousNotice
                        .padding()
                        .background(.bar)
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .interactiveDismissDisabled(model.isBusy)
            .navigationTitle(isAccepted ? "Report received" : isMissing ? "Add a place" : "Report place information")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    if additionalDetailFocused {
                        Spacer()
                        Button("Done") { additionalDetailFocused = false }
                            .accessibilityLabel("Finish editing additional detail")
                            .accessibilityIdentifier("report.note.done")
                    }
                }
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") { dismiss() }.disabled(model.photos.enabled && model.isBusy)
                }
                if model.draft != nil {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Discard draft", role: .destructive) {
                            confirmingDiscard = true
                        }
                        .disabled(isSubmitting)
                    }
                }
            }
            .sheet(isPresented: $showingTerms) {
                if let version = termsVersion { ReportTermsSheet(version: version) }
            }
            .sheet(isPresented: $choosingPin) {
                ReportPinPicker(center: visualCenter, initial: model.draft?.proposedLocation,
                                deviceLocation: deviceLocation, onRequestDeviceLocation: onRequestDeviceLocation) { pin in
                    editDraft { $0.proposedLocation = pin.quantized }
                }
            }
            .confirmationDialog("Discard this saved draft?", isPresented: $confirmingDiscard) {
                Button("Discard draft", role: .destructive) {
                    model.cancel()
                    if model.draft == nil { dismiss() }
                }
                .accessibilityIdentifier("report.discard.confirm")
                Button("Keep draft") {}
                    .accessibilityIdentifier("report.discard.cancel")
            } message: {
                Text("The saved draft and in-app photo selections will be discarded. Originals in your photo library and reports already received by MannerPath are not deleted.")
            }
            .confirmationDialog(model.usesIdempotentRetry
                                ? "Retry the same saved submission? A new security check will be performed."
                                : "The report may already have been received. Submitting again may create a duplicate.",
                                isPresented: $confirmingRetry) {
                Button("Submit again") { Task { await model.retryAmbiguous() } }
                    .accessibilityIdentifier("report.retrySaved.confirm")
            }
            .onAppear {
                if let value = model.draft?.observedOn,
                   let parsed = Self.dayFormatter.date(from: value) {
                    observedDate = parsed
                    hasObservedDate = true
                }
            }
        }
    }

    private var isSubmitting: Bool { model.isBusy }

    private var choosingFollowUp: Bool {
        opensWithFollowUpChoice && !followUpChoiceMade && model.draft == nil && model.hasPendingPhotoFollowUp
    }

    /// Nothing changes until the user picks; closing the form keeps the follow-up. Ending it never deletes the
    /// received report, only the chance to add photos to it.
    private func followUpChoice(_ followUp: ReportPhotoFollowUp) -> some View {
        Section {
            Text("A previous report is still here")
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("report.followUp.choiceTitle")
            Text("It was received, but not all of its photos have been confirmed. Choose what to do next.")
            LabeledContent("Report reference", value: followUp.reportId)
            if confirmingNewReport {
                Text("Adding photos to the previous report will end. The previous report itself stays received and is not deleted.")
                    .accessibilityIdentifier("report.followUp.newReportNotice")
                Button("End adding photos and report a new place", role: .destructive) {
                    model.endPhotoFollowUp()
                    model.startNewSpot(pin: nil)
                }
                .disabled(model.photos.busy)
                .accessibilityIdentifier("report.followUp.confirmNewReport")
                Button("Back") { confirmingNewReport = false }
                    .accessibilityIdentifier("report.followUp.back")
            } else {
                Button("Add photos to the previous report") { followUpChoiceMade = true }
                    .accessibilityIdentifier("report.followUp.resume")
                Button("Report a new smoking place") { confirmingNewReport = true }
                    .accessibilityIdentifier("report.followUp.newReport")
            }
        }
    }

    private var photoIntakePaused: Bool {
        if case .available(let limits) = model.availability { return !limits.acceptsPhotoEvidence }
        return false
    }

    private var newSpotNeedsPhotos: Bool { isMissing && (!model.acceptsNewSpotProposals || model.photos.photos.isEmpty) }

    private var unavailableNotice: String? {
        switch model.availability {
        case .available: nil
        case .attestationUnsupported: String(localized: "Secure reporting isn't supported on this device. Your draft remains saved.")
        default: String(localized: "Submission is unavailable until reporting availability can be confirmed. Your draft remains saved.")
        }
    }

    private var acceptsFindings: Bool {
        if case .available(let limits) = model.availability { return limits.acceptsExistingSpotFindings }
        return false
    }

    /// The version this deployment records consent to; nil for a deployment that predates report terms.
    private var termsVersion: String? {
        if case .available(let limits) = model.availability { return limits.termsVersion }
        return nil
    }

    private var termsAccepted: Bool {
        guard let termsVersion else { return true }
        return model.draft?.acceptedTermsVersion == termsVersion
    }

    private var isAccepted: Bool {
        if case .accepted = model.submission { return true }
        return false
    }

    private var isAmbiguous: Bool {
        if case .ambiguous = model.submission { return true }
        return false
    }

    private var usesScrollableRetryNotice: Bool { isAmbiguous && dynamicTypeSize.isAccessibilitySize }

    // At accessibility sizes this panel belongs to the Form: a fixed multiline notice otherwise leaves very
    // little room for reviewing the saved inputs. The retry still uses the same model gate and confirmation.
    private var ambiguousNotice: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Delivery could not be confirmed. Review the saved submission. It has not been retried automatically.",
                  systemImage: "exclamationmark.triangle")
                .font(.footnote)
                .accessibilityElement(children: .combine)
            if case .available = model.availability, model.canRetryAmbiguous {
                Button {
                    confirmingRetry = true
                } label: {
                    Text(model.usesIdempotentRetry ? String(localized: "Retry saved submission") : String(localized: "Submit again despite possible duplicate"))
                        .frame(minHeight: 44)
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("report.retrySaved")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var status: some View {
        switch model.submission {
        case .idle:
            EmptyView()
        case .preparingSecureSubmission:
            ProgressView("Preparing secure submission…")
        case .submitting:
            ProgressView("Submitting…")
        case .authorizationFailed(let message):
            Text(message)
        case .accepted(let receipt):
            VStack(alignment: .leading, spacing: 8) {
                if model.photos.photos.isEmpty || model.photos.allUploaded {
                    Text("Thanks for your report. It may be reflected after review; the listing has not changed yet.")
                } else if model.photos.busy {
                    Text("The report was received. Sending photos…")
                    Text("Until a photo is received, a new place stays out of review for listing.")
                        .font(.footnote).foregroundStyle(.secondary)
                } else {
                    let unsent = model.photos.photos.count - model.photos.uploadedCount
                    Text("The report was received, but \(unsent) of \(model.photos.photos.count) photos are not confirmed as received. The report will not be sent again.")
                        .accessibilityIdentifier("report-photos-unsent")
                    if model.photos.canRetry {
                        Text("Retry only the unsent photos. Do not submit a new report for the same place.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
                LabeledContent("Report reference", value: receipt.reportId)
                    .textSelection(.enabled)
                if let cleanupError = model.cleanupError {
                    Label(cleanupError, systemImage: "exclamationmark.triangle")
                        .accessibilityIdentifier("report-cleanup-error")
                }
            }
        case .rejected(let message):
            Text("\(message) You can correct it and submit again.")
        case .rateLimited:
            if let seconds = model.retryAfterSecondsRemaining {
                if seconds == 1 {
                    Text("Too many reports. Try again in about 1 second.")
                } else {
                    Text("Too many reports. Try again in about \(seconds) seconds.")
                }
            } else {
                Text("Too many reports. Please try again later.")
            }
        case .ambiguous:
            Text(model.usesIdempotentRetry
                 ? "Delivery could not be confirmed. The same saved submission can be retried when reporting is available."
                 : model.canRetryAmbiguous
                 ? "Delivery could not be confirmed. The report may already have been received. Submitting again could create a duplicate."
                 : "A previous delivery could not be resolved after the app restarted. This saved draft cannot be submitted again; discard it when you are ready.")
        case .idempotencyConflict:
            Text("This saved submission conflicts with an earlier submission. It cannot be sent again. Review or discard the draft; no new report was created by this attempt.")
        case .idempotencyRetired:
            Text("This earlier submission has already been handled and its receipt has expired. The draft will not be sent again.")
            if let cleanupError = model.cleanupError { Text(cleanupError) }
        case .attestationOwnerChanged:
            Text("This device's security key has changed. The saved submission cannot be retried safely. Review or discard the draft; its earlier delivery remains unconfirmed.")
        case .failed(let message):
            Text(message)
        }
    }

    // Keep the report receipt visible even when several photo previews fill the form.
    private var receivedHeading: some View {
        Label(model.photos.photos.isEmpty || model.photos.allUploaded
              ? "Received — awaiting review" : "Report received — photos still pending",
              systemImage: "checkmark.circle")
            .font(.headline)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier(model.photos.photos.isEmpty || model.photos.allUploaded
                                     ? "report.pendingReview" : "report.pendingPhotos")
    }

    private func editDraft(_ edit: (inout ReportDraft) -> Void) {
        guard var draft = model.draft else { return }
        edit(&draft)
        model.saveDraft(draft)
    }

    private func reportSubject(_ draft: ReportDraft) -> String {
        guard draft.spotId != nil else { return String(localized: "A place missing from the map") }
        guard let name = draft.subjectName?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else {
            return String(localized: "Previously selected place (name unavailable)")
        }
        return name
    }

    private static var dayFormatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.isLenient = false
        return formatter
    }

    private static func dayString(_ date: Date) -> String { dayFormatter.string(from: date) }
}

/// What the pin picker can offer as the device's location. Never chosen for the user: a tap places it as the
/// candidate pin, which is then checked, moved if needed and confirmed like any other pin.
enum ReportDeviceLocation: Equatable {
    case available(ReportCoordinate, accuracyMeters: Double, approximate: Bool)
    case locating
    /// Not asked yet, or only an old fix: asking may show the When In Use prompt.
    case canRequest
    case denied
}

private struct ReportPinPicker: View {
    @Environment(\.dismiss) private var dismiss
    let center: SpotCoordinate?
    let initial: ReportCoordinate?
    let deviceLocation: ReportDeviceLocation
    let onRequestDeviceLocation: () -> Void
    let onConfirm: (ReportCoordinate) -> Void

    @State private var position: MapCameraPosition = .automatic
    @State private var candidate: ReportCoordinate?
    @State private var cameraCenter: ReportCoordinate?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    Text("Tap the proposed place on the map, or move the map and use its center. Confirm the selected pin before returning.")
                        .font(.footnote)
                    MapReader { proxy in
                        Map(position: $position) {
                            // The provisional pin being proposed: a standard MapKit marker in MannerPath Yellow (the one
                            // selected-state use of the brand colour here), never red. Its position is the user's tap;
                            // nothing about exactness is inferred from it.
                            if let candidate {
                                Marker(String(localized: "Proposed pin"), systemImage: "mappin",
                                       coordinate: CLLocationCoordinate2D(latitude: candidate.latitude,
                                                                          longitude: candidate.longitude))
                                    .tint(Color("MannerPathYellow"))
                            }
                        }
                        .onTapGesture { point in
                            if let coordinate = proxy.convert(point, from: .local) {
                                candidate = ReportCoordinate(latitude: coordinate.latitude,
                                                             longitude: coordinate.longitude)
                            }
                        }
                        .onMapCameraChange { context in
                            cameraCenter = ReportCoordinate(latitude: context.region.center.latitude,
                                                            longitude: context.region.center.longitude)
                        }
                        .accessibilityLabel("Map for choosing the proposed place")
                        .accessibilityHint("Move the map, then use the map center button. Coordinate controls are available after selection.")
                    }
                    .frame(height: 280)
                    Button {
                        if let cameraCenter { candidate = cameraCenter.quantized }
                    } label: {
                        Text("Use map center").frame(minHeight: 44)
                    }
                    .buttonStyle(.bordered)
                    .disabled(cameraCenter == nil)
                    .accessibilityIdentifier("report.pin.useCenter")
                    // Beside the map choices, never instead of them: the fix is only a starting point to check and move.
                    currentLocationOption
                    if let candidate {
                        Label("Proposed map pin selected", systemImage: "mappin.and.ellipse")
                            .font(.footnote)
                            .accessibilityValue("Latitude \(candidate.latitude.formatted()), longitude \(candidate.longitude.formatted())")
                        Stepper("Latitude \(candidate.latitude.formatted(.number.precision(.fractionLength(5))))",
                                value: candidateBinding(\.latitude), in: -90...90, step: 0.0001)
                        Stepper("Longitude \(candidate.longitude.formatted(.number.precision(.fractionLength(5))))",
                                value: candidateBinding(\.longitude), in: -180...180, step: 0.0001)
                        Button {
                            onConfirm(candidate)
                            dismiss()
                        } label: {
                            Text("Confirm proposed pin").frame(minHeight: 44)
                        }
                        .buttonStyle(.borderedProminent)
                        .accessibilityIdentifier("report.pin.confirm")
                    } else {
                        Text("No pin selected")
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom)
            }
            .navigationTitle("Choose proposed pin")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
            }
            .onAppear {
                candidate = initial
                let latitude = initial?.latitude ?? center?.latitude ?? 35.68
                let longitude = initial?.longitude ?? center?.longitude ?? 139.76
                position = .region(MKCoordinateRegion(
                    center: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
                    span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)
                ))
                cameraCenter = ReportCoordinate(latitude: latitude, longitude: longitude)
            }
        }
    }

    @ViewBuilder
    private var currentLocationOption: some View {
        switch deviceLocation {
        case let .available(coordinate, accuracy, approximate):
            Button {
                candidate = coordinate.quantized
                position = .region(MKCoordinateRegion(
                    center: CLLocationCoordinate2D(latitude: coordinate.latitude, longitude: coordinate.longitude),
                    span: MKCoordinateSpan(latitudeDelta: 0.004, longitudeDelta: 0.004)
                ))
            } label: {
                Label("Use my current location", systemImage: "location.fill")
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("report.pin.useCurrentLocation")
            Text("Current location accuracy: about \(Int(accuracy.rounded())) m. Check the pin on the map and move it to the smoking place before confirming.")
                .font(.footnote)
                .accessibilityIdentifier("report.pin.currentLocationAccuracy")
            if approximate || accuracy > 100 {
                Label("Your location is approximate. Choose the place on the map instead.", systemImage: "exclamationmark.triangle")
                    .font(.footnote)
            }
        case .locating:
            ProgressView("Finding your location…")
                .font(.footnote)
        case .canRequest:
            Button {
                onRequestDeviceLocation()
            } label: {
                Label("Find my current location", systemImage: "location")
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("report.pin.requestLocation")
        case .denied:
            Text("Your current location is not available. Choose the place on the map.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("report.pin.locationUnavailable")
        }
    }

    private func candidateBinding(_ keyPath: WritableKeyPath<ReportCoordinate, Double>) -> Binding<Double> {
        Binding(
            get: { candidate?[keyPath: keyPath] ?? 0 },
            set: { value in
                guard var updated = candidate else { return }
                updated[keyPath: keyPath] = value
                candidate = updated.quantized
                position = .region(MKCoordinateRegion(
                    center: CLLocationCoordinate2D(latitude: updated.latitude, longitude: updated.longitude),
                    span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)
                ))
            }
        )
    }
}

/// ADR-0012 new-spot claim. What kind of smoking place it is comes first and is the one answer a single report
/// needs to be listed; "Not sure" stays a valid answer. Everything else is optional and defaults to "not stated".
private struct NewSpotClaimSection: View {
    @Binding var claim: ReportClaim

    var body: some View {
        Section {
            Text("Choose what you observed. If you do not know a detail, leave it as Not sure or Not stated; do not guess from the shop or facility alone.")
                .font(.footnote).foregroundStyle(.secondary)
            Picker("Kind of smoking place", selection: $claim.spotType) {
                Text("Not sure").tag("unknown")
                Text("Ashtray").tag("ashtray")
                Text("Designated outdoor area").tag("designatedOutdoorArea")
                Text("Public smoking room").tag("publicSmokingRoom")
                Text("Smoking room in a facility").tag("facilitySmokingRoom")
                Text("Smoking permitted inside a shop or café").tag("smokingPermittedVenue")
            }
            .onChange(of: claim.spotType) { _, type in if type == "unknown" { claim.spotSubtype = nil } }
            if claim.spotType != "unknown" {
                Picker("More specific (optional)", selection: $claim.spotSubtype) {
                    Text("Not stated").tag(String?.none)
                    Text("Smoking corner").tag(String?.some("smokingCorner"))
                    Text("Tobacco shop smoking space").tag(String?.some("tobaccoShopSmokingSpace"))
                }
            }
            Picker("Who can use it", selection: $claim.accessType) {
                Text("Not stated").tag(String?.none)
                Text("Anyone").tag(String?.some("public"))
                Text("Customers only").tag(String?.some("customerOnly"))
                Text("Facility users only").tag(String?.some("facilityOnly"))
            }
            .onChange(of: claim.accessType) { _, access in if access != "facilityOnly" { claim.accessDetail = nil } }
            if claim.accessType == "facilityOnly" {
                Toggle("Ticket holders only", isOn: Binding(
                    get: { claim.accessDetail == "ticketedUsersOnly" },
                    set: { claim.accessDetail = $0 ? "ticketedUsersOnly" : nil }
                ))
            }
            Picker("Where is it", selection: $claim.hostType) {
                Text("Not stated").tag(String?.none)
                Text("Convenience store").tag(String?.some("convenienceStore"))
                Text("Tobacco shop").tag(String?.some("tobaccoShop"))
                Text("Restaurant or café").tag(String?.some("restaurantOrCafe"))
                Text("Station").tag(String?.some("station"))
                Text("Airport").tag(String?.some("airport"))
                Text("Commercial building").tag(String?.some("commercialBuilding"))
                Text("Public facility").tag(String?.some("municipality"))
                Text("Other").tag(String?.some("other"))
            }
            // A shop or facility is where the place is, not evidence that smoking is allowed there.
            if claim.spotType == "unknown", claim.hostType != nil {
                Label("A shop or facility alone is not a smoking place. Choose the kind of smoking place you saw, or keep “Not sure”.",
                      systemImage: "info.circle")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("host-not-evidence-note")
            }
            Picker("Indoor or outdoor", selection: $claim.environment) {
                Text("Not stated").tag(String?.none)
                Text("Outdoor").tag(String?.some("outdoor"))
                Text("Covered").tag(String?.some("covered"))
                Text("Indoor").tag(String?.some("indoor"))
            }
            Picker("Paper cigarettes", selection: $claim.supportsPaper) {
                Text("Not stated").tag(String?.none)
                Text("Allowed").tag(String?.some("yes"))
                Text("Not allowed").tag(String?.some("no"))
            }
            Picker("Heated tobacco", selection: $claim.supportsHeated) {
                Text("Not stated").tag(String?.none)
                Text("Allowed").tag(String?.some("yes"))
                Text("Not allowed").tag(String?.some("no"))
            }
            TextField("Shop or facility name (optional)", text: Binding(
                get: { claim.hostName ?? "" },
                set: { claim.hostName = $0.isEmpty ? nil : String($0.prefix(ReportClaim.hostNameMaxLength)) }
            ))
            TextField("Opening hours, if you know them (optional)", text: Binding(
                get: { claim.hoursNote ?? "" },
                set: { claim.hoursNote = $0.isEmpty ? nil : String($0.prefix(ReportClaim.hoursNoteMaxLength)) }
            ))
        } header: {
            Text("4. Describe the smoking place")
        } footer: {
            Text("Say what the smoking place is, not only what shop is there: a convenience store or café by itself is not a smoking place. Names and hours are only for the reviewer and are deleted after 90 days.")
        }
    }
}

/// Which correction claim a report type carries (docs/API.md `claim` on existing-spot reports).
private enum CorrectionKind {
    case type, access, tobacco

    init?(_ type: ReportType) {
        switch type {
        case .typeChanged: self = .type
        case .accessChanged: self = .access
        case .tobaccoTypeChanged: self = .tobacco
        default: return nil
        }
    }
}

private extension ReportCorrection {
    var isEmpty: Bool { self == ReportCorrection() }
}

/// ADR-0013: what the user saw instead. Optional; "Not stated" sends no claim.
private struct CorrectionSection: View {
    let kind: CorrectionKind
    @Binding var correction: ReportCorrection

    var body: some View {
        Section {
            switch kind {
            case .type:
                Picker("What it actually is", selection: $correction.spotType) {
                    Text("Not stated").tag(String?.none)
                    Text("Ashtray").tag(String?.some("ashtray"))
                    Text("Designated outdoor area").tag(String?.some("designatedOutdoorArea"))
                    Text("Public smoking room").tag(String?.some("publicSmokingRoom"))
                    Text("Smoking room in a facility").tag(String?.some("facilitySmokingRoom"))
                    Text("Smoking permitted inside a shop or café").tag(String?.some("smokingPermittedVenue"))
                }
                .onChange(of: correction.spotType) { _, type in if type == nil { correction.spotSubtype = nil } }
            case .access:
                Picker("Who can actually use it", selection: $correction.accessType) {
                    Text("Not stated").tag(String?.none)
                    Text("Anyone").tag(String?.some("public"))
                    Text("Customers only").tag(String?.some("customerOnly"))
                    Text("Facility users only").tag(String?.some("facilityOnly"))
                }
                .onChange(of: correction.accessType) { _, access in if access != "facilityOnly" { correction.accessDetail = nil } }
                if correction.accessType == "facilityOnly" {
                    Toggle("Ticket holders only", isOn: Binding(
                        get: { correction.accessDetail == "ticketedUsersOnly" },
                        set: { correction.accessDetail = $0 ? "ticketedUsersOnly" : nil }
                    ))
                }
            case .tobacco:
                Picker("Paper cigarettes", selection: $correction.supportsPaper) {
                    Text("Not stated").tag(String?.none)
                    Text("Allowed").tag(String?.some("yes"))
                    Text("Not allowed").tag(String?.some("no"))
                }
                Picker("Heated tobacco", selection: $correction.supportsHeated) {
                    Text("Not stated").tag(String?.none)
                    Text("Allowed").tag(String?.some("yes"))
                    Text("Not allowed").tag(String?.some("no"))
                }
            }
        } header: {
            Text("What did you see? (optional)")
        } footer: {
            Text("A reviewer compares this with other reports and sources. One report never changes the listing by itself.")
        }
    }
}
