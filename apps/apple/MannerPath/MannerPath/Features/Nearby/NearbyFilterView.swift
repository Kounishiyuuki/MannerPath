import SwiftUI

struct NearbyFilterView: View {
    @Binding var filters: NearbyFilters

    private let types: [SpotType] = [
        .designatedOutdoorArea, .publicSmokingRoom, .facilitySmokingRoom,
        .ashtray, .smokingPermittedVenue, .unknown
    ]
    private let environments: [SpotEnvironment] = [.indoor, .outdoor, .covered, .unknown]
    private let accessTypes: [AccessType] = [.public, .customerOnly, .facilityOnly, .unknown]

    // Standard Form sections, one per question (DESIGN §5.8). Only existing filter fields; an unknown value is never
    // treated as "not available": unknown support, access, environment and hours stay listed unless a "confirmed"
    // option asks for confirmation explicitly.
    var body: some View {
        Group {
            Section {
                // Coverage first (ADR-0012): every usable listing is shown unless the user narrows it here.
                Picker("Show", selection: quickScope) {
                    Text("All places").tag(QuickScope.all)
                    Text("Anyone can use").tag(QuickScope.publicAccess)
                    Text("Confirmed only").tag(QuickScope.verified)
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("nearby-quick-scope")
            } footer: {
                Text("“Confirmed only” hides places reported by a single user that nobody else has confirmed yet.")
            }

            Section {
                Picker("Tobacco type", selection: $filters.tobaccoType) {
                    Text("Any").tag(nil as TobaccoType?)
                    Text("Paper").tag(TobaccoType?.some(.paper))
                    Text("Heated").tag(TobaccoType?.some(.heated))
                }
                Toggle("Confirmed tobacco support only", isOn: $filters.requireConfirmedTobaccoSupport)
                    .disabled(filters.tobaccoType == nil)
            } header: {
                Text("Tobacco")
            } footer: {
                Text("Unknown support remains visible unless confirmation is required. Confirmed unsupported places are excluded.")
            }

            Section("Place and access") {
                Menu {
                    Button("Any physical type") { filters.spotTypes = nil }
                    ForEach(types, id: \.self) { type in
                        Button {
                            var selected = filters.spotTypes ?? []
                            if !selected.insert(type).inserted { selected.remove(type) }
                            filters.spotTypes = selected.isEmpty ? nil : selected
                        } label: {
                            Label(SpotPresentation.type(type),
                                  systemImage: filters.spotTypes?.contains(type) == true ? "checkmark" : "")
                        }
                    }
                } label: { Label("Physical type: \(selectionSummary(filters.spotTypes?.count))", systemImage: "line.3.horizontal.decrease") }

                Toggle("Public access only", isOn: $filters.publicAccessOnly)
                Toggle("Confirmed public access only", isOn: $filters.requireConfirmedPublicAccess)
                    .disabled(!filters.publicAccessOnly)

                Menu {
                    Button("Any access type") { filters.accessTypes = nil }
                    ForEach(accessTypes, id: \.self) { access in
                        Button {
                            var selected = filters.accessTypes ?? []
                            if !selected.insert(access).inserted { selected.remove(access) }
                            filters.accessTypes = selected.isEmpty ? nil : selected
                        } label: {
                            Label(SpotPresentation.access(access),
                                  systemImage: filters.accessTypes?.contains(access) == true ? "checkmark" : "")
                        }
                    }
                } label: { Label("Access type: \(selectionSummary(filters.accessTypes?.count))", systemImage: "person.crop.circle") }

                Menu {
                    Button("Any environment") { filters.environments = nil }
                    ForEach(environments, id: \.self) { environment in
                        Button {
                            var selected = filters.environments ?? []
                            if !selected.insert(environment).inserted { selected.remove(environment) }
                            filters.environments = selected.isEmpty ? nil : selected
                        } label: {
                            Label(SpotPresentation.environment(environment),
                                  systemImage: filters.environments?.contains(environment) == true ? "checkmark" : "")
                        }
                    }
                } label: { Label("Environment: \(selectionSummary(filters.environments?.count))", systemImage: "leaf") }
            }

            Section {
                Toggle("Confirmed open now", isOn: $filters.openNowOnly)
            } header: {
                Text("Opening hours")
            } footer: {
                Text("Off by default. Places with unknown hours are never treated as closed; this option shows only places reported open now.")
            }

            Section("Evidence and freshness") {
                Toggle("Official listing evidence", isOn: $filters.officialEvidenceOnly)
                Toggle("Confirmed places only", isOn: $filters.verifiedEvidenceOnly)
                Picker("Verified within", selection: $filters.verifiedWithin) {
                    Text("Any date").tag(nil as TimeInterval?)
                    Text("30 days").tag(TimeInterval?.some(30 * 86_400))
                    Text("90 days").tag(TimeInterval?.some(90 * 86_400))
                    Text("1 year").tag(TimeInterval?.some(365 * 86_400))
                }
            }

            Section("Distance") {
                Picker("Maximum straight-line distance", selection: $filters.maximumDistanceMeters) {
                    Text("Any").tag(nil as Double?)
                    Text("500 m").tag(Double?.some(500))
                    Text("1 km").tag(Double?.some(1_000))
                    Text("2 km").tag(Double?.some(2_000))
                    Text("5 km").tag(Double?.some(5_000))
                }
            }

            if filters != NearbyFilters() {
                Section {
                    Button("Reset all filters") { filters = NearbyFilters() }
                        .accessibilityIdentifier("reset-filters")
                }
            }
        }
        .onChange(of: filters.tobaccoType) { _, value in
            if value == nil { filters.requireConfirmedTobaccoSupport = false }
        }
        .onChange(of: filters.publicAccessOnly) { _, value in
            if !value { filters.requireConfirmedPublicAccess = false }
        }
    }

    private enum QuickScope: Hashable { case all, publicAccess, verified }

    // The quick scope is a view of two existing filters, so it never disagrees with the detailed toggles below.
    private var quickScope: Binding<QuickScope> {
        Binding(
            get: {
                if filters.verifiedEvidenceOnly && !filters.publicAccessOnly { return .verified }
                if filters.publicAccessOnly && !filters.verifiedEvidenceOnly { return .publicAccess }
                return .all
            },
            set: { scope in
                filters.verifiedEvidenceOnly = scope == .verified
                filters.publicAccessOnly = scope == .publicAccess
            }
        )
    }

    private func selectionSummary(_ count: Int?) -> String {
        guard let count else { return String(localized: "Any") }
        return String(localized: "\(count) selected")
    }
}
