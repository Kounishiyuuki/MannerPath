import SwiftUI

struct NearbyFilterView: View {
    @Binding var filters: NearbyFilters

    private let types: [SpotType] = [
        .designatedOutdoorArea, .publicSmokingRoom, .facilitySmokingRoom,
        .ashtray, .smokingPermittedVenue, .unknown
    ]
    private let environments: [SpotEnvironment] = [.indoor, .outdoor, .covered, .unknown]
    private let accessTypes: [AccessType] = [.public, .customerOnly, .facilityOnly, .unknown]

    var body: some View {
        DisclosureGroup("Filters") {
            VStack(alignment: .leading, spacing: 12) {
                Picker("Tobacco type", selection: $filters.tobaccoType) {
                    Text("Any").tag(nil as TobaccoType?)
                    Text("Paper").tag(TobaccoType?.some(.paper))
                    Text("Heated").tag(TobaccoType?.some(.heated))
                }
                .pickerStyle(.segmented)
                Toggle("Confirmed tobacco support only", isOn: $filters.requireConfirmedTobaccoSupport)
                    .disabled(filters.tobaccoType == nil)
                Text("Unknown support remains visible unless confirmation is required. Confirmed unsupported places are excluded.")
                    .font(.footnote).foregroundStyle(.secondary)

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
                } label: { Label("Physical type: \(filters.spotTypes == nil ? "Any" : "\(filters.spotTypes!.count) selected")", systemImage: "line.3.horizontal.decrease") }

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
                } label: { Label("Access type: \(filters.accessTypes == nil ? "Any" : "\(filters.accessTypes!.count) selected")", systemImage: "person.crop.circle") }

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
                } label: { Label("Environment: \(filters.environments == nil ? "Any" : "\(filters.environments!.count) selected")", systemImage: "leaf") }

                Toggle("Confirmed open now", isOn: $filters.openNowOnly)
                Toggle("Official listing evidence", isOn: $filters.officialEvidenceOnly)
                Picker("Verified within", selection: $filters.verifiedWithin) {
                    Text("Any date").tag(nil as TimeInterval?)
                    Text("30 days").tag(TimeInterval?.some(30 * 86_400))
                    Text("90 days").tag(TimeInterval?.some(90 * 86_400))
                    Text("1 year").tag(TimeInterval?.some(365 * 86_400))
                }
                Picker("Maximum straight-line distance", selection: $filters.maximumDistanceMeters) {
                    Text("Any").tag(nil as Double?)
                    Text("500 m").tag(Double?.some(500))
                    Text("1 km").tag(Double?.some(1_000))
                    Text("2 km").tag(Double?.some(2_000))
                    Text("5 km").tag(Double?.some(5_000))
                }
            }
            .font(.subheadline)
            .padding(.top, 8)
        }
        .onChange(of: filters.tobaccoType) { _, value in
            if value == nil { filters.requireConfirmedTobaccoSupport = false }
        }
        .onChange(of: filters.publicAccessOnly) { _, value in
            if !value { filters.requireConfirmedPublicAccess = false }
        }
    }
}
