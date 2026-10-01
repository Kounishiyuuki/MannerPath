import SwiftUI

/// ADR-0013 one-tap "it was here": the confirmation the app asks for most, in at most two taps once the user has agreed
/// to the current report terms. No free text, no date, no location: the report names the place, not the person.
struct QuickConfirmView: View {
    @Environment(\.dismiss) private var dismiss
    @Bindable var model: ReportModel
    @State private var showingTerms = false

    var body: some View {
        NavigationStack {
            Form {
                if let draft = model.draft, draft.type == .exists {
                    Section {
                        Text(draft.subjectName ?? String(localized: "Previously selected place (name unavailable)"))
                            .font(.headline)
                        Text("You're confirming that this smoking place is still here. Nothing else about you or your location is sent.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    if let version = termsVersion {
                        Section {
                            Button("Read the report terms") { showingTerms = true }
                            Toggle("I agree to the report terms", isOn: Binding(
                                get: { draft.acceptedTermsVersion == version },
                                set: { model.setTermsAccepted($0) }
                            ))
                            .disabled(model.isBusy)
                        } footer: {
                            Text("Terms version \(version)")
                        }
                    }
                    Section {
                        TimelineView(.periodic(from: .now, by: 1)) { _ in
                            Button {
                                Task { await model.submit() }
                            } label: {
                                Label("Send confirmation", systemImage: "checkmark.circle.fill")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(model.isBusy || !termsAccepted || (model.retryAfterSecondsRemaining ?? 0) > 0
                                      || model.submission == .ambiguous)
                        }
                    }
                }
                Section { status }
            }
            .navigationTitle("It was here")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(isAccepted ? "Done" : "Cancel") { close() }
                        .disabled(model.isBusy)
                }
            }
            .sheet(isPresented: $showingTerms) {
                if let version = termsVersion { ReportTermsSheet(version: version) }
            }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(model.isBusy)
    }

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

    /// A quick confirmation that was never sent is not kept as a saved draft. An ambiguous delivery is kept, so the
    /// user can see it from the main screen rather than lose track of a report that may have arrived.
    private func close() {
        if model.draft?.type == .exists && model.submission != .ambiguous { model.cancel() }
        dismiss()
    }

    @ViewBuilder
    private var status: some View {
        switch model.submission {
        case .idle: EmptyView()
        case .preparingSecureSubmission: ProgressView("Preparing secure submission…")
        case .submitting: ProgressView("Submitting…")
        case .accepted:
            Label("Thanks for checking. Confirmations may be reflected after review.", systemImage: "checkmark.circle")
        case .authorizationFailed(let message), .rejected(let message), .failed(let message):
            Text(message)
        case .rateLimited:
            Text("Too many reports. Please try again later.")
        case .ambiguous:
            Text("Delivery could not be confirmed. The confirmation may already have been received; it stays saved on this device.")
        }
    }
}
