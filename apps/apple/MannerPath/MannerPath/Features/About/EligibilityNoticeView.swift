import SwiftUI

struct EligibilityNoticeView: View {
    let onContinue: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Image(systemName: "location.circle")
                        .font(.system(size: 52))
                        .foregroundStyle(.tint)
                        .accessibilityHidden(true)

                    Text("Find permitted smoking locations")
                        .font(.title.bold())
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)

                    Text("MannerPath is a navigation aid for people who are legally permitted to smoke. It does not sell or promote tobacco.")
                    Text("In Japan, you must be at least 20 to smoke or enter a smoking area.")

                    Label("A nearby result does not by itself confirm that smoking is legal at that moment.", systemImage: "exclamationmark.triangle")
                    Label("Check posted signs and follow the location's rules and local law.", systemImage: "signpost.right")
                    Label("Opening hours, access, and supported tobacco types may be unknown or out of date.", systemImage: "clock.badge.questionmark")

                    Button("I understand") { onContinue() }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .frame(maxWidth: .infinity)
                        .accessibilityHint("Continues to nearby places")
                }
                .frame(maxWidth: 560, alignment: .leading)
                .padding()
            }
            .navigationTitle("Before you continue")
            .navigationBarTitleDisplayMode(.inline)
        }
        .interactiveDismissDisabled()
    }
}
