import SwiftUI

/// The report terms shown before consent (docs/legal/, Issue #124): a short summary that states every right the
/// terms take, then the bundled full text one tap away. The version shown is the one the user's agreement records.
struct ReportTermsSheet: View {
    @Environment(\.dismiss) private var dismiss
    let version: String

    var body: some View {
        NavigationStack {
            List {
                if ReportTerms.document(for: version)?.isDraft ?? true {
                    Section {
                        Label("Draft terms awaiting legal review. Reports are stored for review, but nothing you submit is published on the basis of these draft terms.",
                              systemImage: "exclamationmark.triangle")
                            .font(.footnote)
                    }
                }
                Section("What MannerPath does with a report") {
                    Text("Stores and reviews it (moderation), and compares it with other reports and sources.")
                    Text("A report is never published immediately. Only reviewed information can become map data.")
                    Text("A report may not be used. It is shown as a user report, never as official information.")
                    Text("After review, the resulting information (the adopted place and its confirmed state) may be published and redistributed through the app, the API, map tiles and data exports, labelled as reviewed user reports, separately from official data.")
                }
                Section("What is never published") {
                    Text("Your note, observation day, submission time, report reference or anything that could identify you.")
                    Text("No account is needed. Your device location and location history are not sent.")
                }
                Section("Retention") {
                    Text("Personal content in a report (note, proposed pin, observation day) is deleted within 90 days of receipt.")
                }
                Section {
                    if let fullText = ReportTerms.fullText(for: version) {
                        NavigationLink("Read the full terms") {
                            ReportTermsFullText(text: fullText)
                        }
                    }
                    LabeledContent("Terms version", value: version)
                        .textSelection(.enabled)
                }
            }
            .navigationTitle("Report terms")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

/// The bundled terms document, verbatim apart from inline Markdown emphasis.
private struct ReportTermsFullText: View {
    let text: String

    var body: some View {
        ScrollView {
            Text(rendered)
                .font(.footnote)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
        }
        .navigationTitle("Full terms")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var rendered: AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
    }
}
