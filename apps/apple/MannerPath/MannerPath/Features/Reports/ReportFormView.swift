import MapKit
import SwiftUI

struct ReportFormView: View {
    @Environment(\.dismiss) private var dismiss
    @Bindable var model: ReportModel
    let visualCenter: SpotCoordinate?

    @State private var observedDate = Date()
    @State private var hasObservedDate = false
    @State private var choosingPin = false
    @State private var confirmingRetry = false
    @State private var showingTerms = false

    private var isMissing: Bool { model.draft?.type == .missing }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("This is a proposal for review. Submitting it does not immediately change the listing.")
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
                                    model.saveDraft(edited)
                                }
                            )) {
                                ForEach(ReportType.allCases.filter { $0 != .missing }, id: \.self) { type in
                                    Text(type.title).tag(type)
                                }
                            }
                        }
                    } else {
                        Section("What needs review?") { Text(ReportType.missing.title) }
                    }

                    if draft.type == .moved || draft.type == .missing {
                        Section("Proposed place") {
                            Button(draft.proposedLocation == nil ? "Choose a map pin" : "Change proposed pin") {
                                choosingPin = true
                            }
                            if let pin = draft.proposedLocation {
                                Label("Proposed map pin selected", systemImage: "mappin.and.ellipse")
                                    .font(.footnote).foregroundStyle(.secondary)
                                    .accessibilityValue("Latitude \(pin.latitude.formatted()), longitude \(pin.longitude.formatted())")
                            } else {
                                Text("Tap a point on the map and confirm it. Your device location is never selected automatically.")
                                    .font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                    }

                    if isMissing, case .available(let limits) = model.availability, limits.acceptsNewSpotClaim {
                        NewSpotClaimSection(claim: Binding(
                            get: { model.draft?.claim ?? ReportClaim() },
                            set: { value in editDraft { $0.claim = value } }
                        ))
                    }

                    Section("When did you observe this? (optional)") {
                        Toggle("Add observation day", isOn: $hasObservedDate)
                            .onChange(of: hasObservedDate) { _, enabled in
                                editDraft { $0.observedOn = enabled ? Self.dayString(observedDate) : nil }
                            }
                        if hasObservedDate {
                            DatePicker("Day", selection: $observedDate, displayedComponents: .date)
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
                        .frame(minHeight: 100)
                        .accessibilityLabel("Additional report detail")
                        if case .available(let limits) = model.availability {
                            Text("\(draft.note?.utf16.count ?? 0) / \(limits.noteMaxLength) text units (emoji may count as two)")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }

                    if let version = termsVersion {
                        Section {
                            Button("Read the report terms") { showingTerms = true }
                            Toggle("I agree to the report terms", isOn: Binding(
                                get: { draft.acceptedTermsVersion == version },
                                set: { model.setTermsAccepted($0) }
                            ))
                            .disabled(isSubmitting)
                        } header: {
                            Text("Report terms")
                        } footer: {
                            Text("Required before submitting. Terms version \(version)")
                        }
                    }

                    Section {
                        if case .available = model.availability {
                            TimelineView(.periodic(from: .now, by: 1)) { _ in
                                Button("Submit for review") { Task { await model.submit() } }
                                    .disabled(isSubmitting || isAccepted || isAmbiguous || !termsAccepted ||
                                              (model.retryAfterSecondsRemaining ?? 0) > 0)
                            }
                            if model.canRetryAmbiguous {
                                Button("Submit again despite possible duplicate") {
                                    confirmingRetry = true
                                }
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
                Section { status }
            }
            .navigationTitle(isMissing ? "Suggest missing place" : "Report place information")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") { dismiss() }
                }
                if model.draft != nil {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Discard draft", role: .destructive) {
                            model.cancel()
                            if model.draft == nil { dismiss() }
                        }
                        .disabled(isSubmitting)
                    }
                }
            }
            .sheet(isPresented: $showingTerms) {
                if let version = termsVersion { ReportTermsSheet(version: version) }
            }
            .sheet(isPresented: $choosingPin) {
                ReportPinPicker(center: visualCenter, initial: model.draft?.proposedLocation) { pin in
                    editDraft { $0.proposedLocation = pin.quantized }
                }
            }
            .confirmationDialog("The report may already have been received. Submitting again may create a duplicate.",
                                isPresented: $confirmingRetry) {
                Button("Submit again") { Task { await model.retryAmbiguous() } }
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
            VStack(alignment: .leading) {
                Text("Your report was received for review. The listing has not changed.")
                LabeledContent("Report reference", value: receipt.reportId)
                    .textSelection(.enabled)
                if let cleanupError = model.cleanupError { Text(cleanupError).foregroundStyle(.red) }
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
            Text(model.canRetryAmbiguous
                 ? "Delivery could not be confirmed. The report may already have been received. Submitting again could create a duplicate."
                 : "A previous delivery could not be resolved after the app restarted. This saved draft cannot be submitted again; discard it when you are ready.")
        case .failed(let message):
            Text(message)
        }
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

private struct ReportPinPicker: View {
    @Environment(\.dismiss) private var dismiss
    let center: SpotCoordinate?
    let initial: ReportCoordinate?
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
                        .padding(.horizontal)
                    MapReader { proxy in
                        Map(position: $position) {
                            if let candidate {
                                Annotation("Proposed pin", coordinate: CLLocationCoordinate2D(
                                    latitude: candidate.latitude, longitude: candidate.longitude
                                )) { Image(systemName: "mappin.circle.fill").font(.largeTitle).foregroundStyle(.red) }
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
                    Button("Use map center") {
                        if let cameraCenter { candidate = cameraCenter.quantized }
                    }
                    .buttonStyle(.bordered)
                    .disabled(cameraCenter == nil)
                    if let candidate {
                        Label("Proposed map pin selected", systemImage: "mappin.and.ellipse")
                            .font(.footnote)
                            .accessibilityValue("Latitude \(candidate.latitude.formatted()), longitude \(candidate.longitude.formatted())")
                        Stepper("Latitude \(candidate.latitude.formatted(.number.precision(.fractionLength(5))))",
                                value: candidateBinding(\.latitude), in: -90...90, step: 0.0001)
                        Stepper("Longitude \(candidate.longitude.formatted(.number.precision(.fractionLength(5))))",
                                value: candidateBinding(\.longitude), in: -180...180, step: 0.0001)
                        Button("Confirm proposed pin") {
                            onConfirm(candidate)
                            dismiss()
                        }
                        .buttonStyle(.borderedProminent)
                    } else {
                        Text("No pin selected")
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.bottom)
            }
            .navigationTitle("Choose proposed pin")
            .toolbar { Button("Close") { dismiss() } }
            .onAppear {
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
            Text("About this place")
        } footer: {
            Text("Say what the smoking place is, not only what shop is there: a convenience store or café by itself is not a smoking place. Names and hours are only for the reviewer and are deleted after 90 days.")
        }
    }
}
