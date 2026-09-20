import SwiftUI

struct NearbyAttributionView: View {
    let sources: [SpotSource]

    var body: some View {
        List {
            Section {
                Text("Attribution for sources stored with the nearby tile cache. This information remains available without a network connection. A source can appear more than once when saved tiles contain different wording.")
                    .font(.footnote)
            }
            if sources.isEmpty {
                ContentUnavailableView("No cached source attribution", systemImage: "doc.text.magnifyingglass")
            } else {
                ForEach(sources.indices, id: \.self) { index in
                    let source = sources[index]
                    Section(source.displayName) {
                        if let text = source.attributionText, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            Text(text)
                                .textSelection(.enabled)
                                .accessibilityLabel("Attribution: \(text)")
                        } else {
                            Text("Attribution text unavailable in cached data")
                                .foregroundStyle(.secondary)
                        }
                        LabeledContent("License", value: source.licenseName ?? "Unknown")
                        if let rawURL = source.licenseURL {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("License URL")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                Text(rawURL)
                                    .textSelection(.enabled)
                            }
                            if let url = URL(string: rawURL) {
                                Link("Open license", destination: url)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Sources and attribution")
        .navigationBarTitleDisplayMode(.inline)
    }
}
