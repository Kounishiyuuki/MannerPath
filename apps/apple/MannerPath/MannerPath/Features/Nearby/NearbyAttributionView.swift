import SwiftUI

struct NearbyAttributionView: View {
    let sources: [SpotSource]

    var body: some View {
        List {
            Section {
                Text("Attribution for sources stored with the nearby tile cache. This information remains available without a network connection. A source can appear more than once when saved tiles contain different wording.")
                    .font(.footnote)
            }
            if !sources.isEmpty {
                Section("MannerPath processing") {
                    Text(verbatim: SourceAttributionPresentation.modificationNotice)
                        .font(.footnote)
                        .accessibilityIdentifier("sourceModificationNotice")
                }
            }
            if sources.isEmpty {
                ContentUnavailableView("No cached source attribution", systemImage: "doc.text.magnifyingglass")
            } else {
                ForEach(sources.indices, id: \.self) { index in
                    let source = sources[index]
                    Section(source.displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            ? String(localized: "Source name unavailable") : source.displayName) {
                        if let text = source.attributionText, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            Text(text)
                                .textSelection(.enabled)
                                .accessibilityLabel("Attribution: \(text)")
                        } else {
                            Text("Attribution text unavailable in cached data")
                                .foregroundStyle(.secondary)
                        }
                        LabeledContent("License", value: source.licenseName ?? String(localized: "Unknown"))
                        if let rawURL = source.licenseURL {
                            if let url = SourceAttributionPresentation.licenseURL(rawURL) {
                                Link("Open license information", destination: url)
                                    .accessibilityIdentifier("sourceLicenseLink")
                            } else {
                                Text(rawURL).textSelection(.enabled)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Sources")
        .navigationBarTitleDisplayMode(.inline)
    }
}
