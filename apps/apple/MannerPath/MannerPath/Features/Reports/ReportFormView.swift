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

    private var isMissing: Bool { model.draft?.type == .missing }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("This is a proposal for review. Submitting it does not immediately change the listing.")
                }

                if let draft = model.draft {
                    Section("Report subject") {
                        Text(draft.spotId.map { "Existing place: \($0)" } ?? "A place missing from the map")
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
                                Text(String(format: "Chosen pin: %.5f, %.5f", pin.latitude, pin.longitude))
                                    .font(.footnote).foregroundStyle(.secondary)
                            } else {
                                Text("Tap a point on the map and confirm it. Your device location is never selected automatically.")
                                    .font(.footnote).foregroundStyle(.secondary)
                            }
                        }
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
                        if case .available(let limits) = model.availability {
                            Text("\(draft.note?.count ?? 0) / \(limits.noteMaxLength) characters")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }

                    Section {
                        if case .available = model.availability {
                            TimelineView(.periodic(from: .now, by: 1)) { _ in
                                Button("Submit for review") { Task { await model.submit() } }
                                    .disabled(isSubmitting || isAccepted || isAmbiguous ||
                                              (model.retryAfterSecondsRemaining ?? 0) > 0)
                            }
                            if isAmbiguous {
                                Button("Submit again despite possible duplicate") {
                                    confirmingRetry = true
                                }
                            }
                        } else {
                            Text("Submission is unavailable until this server confirms reporting is supported. Your draft remains saved.")
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
            .sheet(isPresented: $choosingPin) {
                ReportPinPicker(center: visualCenter, initial: model.draft?.proposedLocation) { pin in
                    editDraft { $0.proposedLocation = pin }
                }
            }
            .confirmationDialog("The server may already have received this report. Submitting again may create a duplicate.",
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

    private var isSubmitting: Bool {
        if case .submitting = model.submission { return true }
        return false
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
        case .submitting:
            ProgressView("Submitting…")
        case .accepted(let receipt):
            VStack(alignment: .leading) {
                Text("Report \(receipt.reportId) was received for review. The listing has not changed.")
                if let cleanupError = model.cleanupError { Text(cleanupError).foregroundStyle(.red) }
            }
        case .rejected(let message):
            Text("The server rejected this report: \(message). You can correct it and submit again.")
        case .rateLimited:
            Text(model.retryAfterSecondsRemaining.map { "Too many reports. Try again in about \($0) seconds." } ??
                 "Too many reports. Please try again later.")
        case .ambiguous:
            Text("Delivery could not be confirmed. The server may already have received this report. Submitting again could create a duplicate.")
        case .failed(let message):
            Text(message)
        }
    }

    private func editDraft(_ edit: (inout ReportDraft) -> Void) {
        guard var draft = model.draft else { return }
        edit(&draft)
        model.saveDraft(draft)
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

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                Text("Tap the proposed place on the map, then confirm the pin. Centering the map does not select a place.")
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
                }
                if let candidate {
                    Text(String(format: "Selected: %.5f, %.5f", candidate.latitude, candidate.longitude))
                        .font(.footnote)
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
            .navigationTitle("Choose proposed pin")
            .toolbar { Button("Close") { dismiss() } }
            .onAppear {
                let latitude = initial?.latitude ?? center?.latitude ?? 35.68
                let longitude = initial?.longitude ?? center?.longitude ?? 139.76
                position = .region(MKCoordinateRegion(
                    center: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
                    span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)
                ))
            }
        }
    }
}
