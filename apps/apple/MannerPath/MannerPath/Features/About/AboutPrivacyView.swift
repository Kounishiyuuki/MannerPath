import SwiftUI

struct AboutPrivacyView: View {
    let sources: [SpotSource]

    var body: some View {
        List {
            Section("Eligibility and local rules") {
                Text("MannerPath is for people who are legally permitted to smoke. A place appearing nearby does not guarantee that smoking is currently legal there. Follow posted signs, on-site rules, and local law.")
            }

            Section("Location") {
                Label("Your current location is used on this device to rank nearby places and calculate distance and direction.", systemImage: "location")
                Label("MannerPath does not intentionally collect a history of your locations.", systemImage: "clock.arrow.circlepath")
                Label("Cached nearby data remains available offline. Walking routes may require a network connection.", systemImage: "internaldrive")
            }

            Section("Apple Watch") {
                Text("The iPhone sends the Watch a compact cached set of nearby places, source information, and filter preferences. The Watch uses its own current location for distance and direction.")
            }

            Section("Reports") {
                Text("Reports are proposals for review and do not immediately change a listing.")
                Text("For a missing or moved place, the proposed location is a map pin you choose. MannerPath does not automatically use your device position as that pin.")
                Text("A saved draft stays on this device until it is submitted or discarded.")
            }

            Section("Data quality") {
                Text("Source dates, opening hours, access, and supported tobacco types may be unknown or stale. Unknown does not mean open, closed, allowed, or prohibited.")
                NavigationLink("Sources and attribution") {
                    NearbyAttributionView(sources: sources)
                }
            }

            Section("Diagnostics") {
                Text("This beta does not include third-party analytics, advertising trackers, or a crash-reporting SDK.")
            }
        }
        .navigationTitle("Data & Privacy")
        .navigationBarTitleDisplayMode(.inline)
    }
}
