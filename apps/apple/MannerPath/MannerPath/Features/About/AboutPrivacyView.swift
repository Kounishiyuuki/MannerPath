import SwiftUI

struct AboutPrivacyView: View {
    let sources: [SpotSource]
    let reportModel: ReportModel

    var body: some View {
        List {
            Section {
                if let links = PublicSite.links {
                    Link(destination: links.privacyPolicy) {
                        Label("Privacy Policy", systemImage: "hand.raised")
                    }
                    Link(destination: links.support) {
                        Label("Support", systemImage: "questionmark.circle")
                    }
                }
                Link(destination: PublicSite.contactURL) {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Contact by email")
                            Text(verbatim: PublicSite.contactEmail)
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    } icon: {
                        Image(systemName: "envelope")
                    }
                }
                LabeledContent("Operator") { Text(verbatim: PublicSite.operatorName) }
            } header: {
                Text("Privacy Policy and Support")
            } footer: {
                Text("Questions, privacy requests, and corrections or removal of place information can be sent by email.")
            }

            Section("Eligibility and local rules") {
                Text("MannerPath is for people who are legally permitted to smoke. A place appearing nearby does not guarantee that smoking is currently legal there. Follow posted signs, on-site rules, and local law.")
            }

            Section("Location") {
                Label("Your current location is used on this device to rank nearby places and calculate distance and direction.", systemImage: "location")
                Label("MannerPath does not intentionally save a history of your locations.", systemImage: "clock.arrow.circlepath")
                Text("Downloading place data sends geographic tile IDs, rather than raw device GPS coordinates, to MannerPath's service. Network services may process IP addresses and request information.")
                Text("Apple MapKit search and routing, and system Maps, may communicate location and request information with Apple's services.")
                Label("With cached data and a usable location, saved places, straight-line distance and direction remain available offline. Offline walking routes are not provided.", systemImage: "internaldrive")
            }

            Section("Apple Watch") {
                Text("The iPhone sends the Watch a compact cached set of nearby places, source information, and filter preferences. The Watch uses its own current location for distance and direction.")
            }

            Section("Reports") {
                ForEach(AboutPrivacyCopy.reportParagraphs(for: reportModel.availability), id: \.self) { paragraph in
                    Text(verbatim: paragraph)
                }
                Text("Browsing does not register this device for reports. Secure registration is attempted only when you submit a report, if required.")
                Text("Photo uploads are unavailable in this version.")
                Text("Any saved report draft remains on this device. You can review or discard it even when reporting is unavailable.")
            }

            Section("Data quality") {
                Text("Source dates, opening hours, access, and supported tobacco types may be unknown or stale. Unknown does not mean open, closed, allowed, or prohibited.")
                NavigationLink("Sources and attribution") {
                    NearbyAttributionView(sources: sources)
                }
            }

            Section("Diagnostics") {
                Text("MannerPath does not include third-party analytics, advertising trackers, or a crash-reporting SDK.")
            }
        }
        .navigationTitle("Data & Privacy")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Uses the same live availability as report entry points; unknown must never advertise intake.
nonisolated enum AboutPrivacyCopy {
    static func reportParagraphs(for availability: ReportAvailability) -> [String] {
        switch availability {
        case .unknown:
            [String(localized: "Report availability could not be checked. Try again when connected.")]
        case .unavailable:
            [String(localized: "Reports are currently unavailable.")]
        case .incompatible:
            [String(localized: "Update the app to submit reports.")]
        case .attestationUnsupported:
            [String(localized: "Secure reporting isn't supported on this device.")]
        case .available:
            [String(localized: "Reports are proposals for review and do not immediately change a listing."),
             String(localized: "For a missing or moved place, the proposed location is a map pin you choose. MannerPath does not automatically use your device position as that pin.")]
        }
    }
}
