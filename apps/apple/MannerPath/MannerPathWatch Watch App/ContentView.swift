import SwiftUI

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var model = WatchNearbyModel()

    var body: some View {
        NavigationStack {
            List {
                if model.snapshot == nil {
                    Text("Open MannerPath on iPhone once to save nearby places.")
                } else {
                    if model.latitude == nil {
                        Text("Saved places · Watch location needed for distance and direction")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    Section("Nearby") {
                        ForEach(model.results, id: \.spot.id) { result in
                            NavigationLink {
                                detail(result)
                            } label: {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(name(result.spot)).font(.headline)
                                    Text(type(result.spot.spotType)).font(.caption)
                                    if result.distanceMeters.isFinite {
                                        Text("\(distance(result.distanceMeters)) · \(bearing(result))")
                                            .font(.caption)
                                    }
                                    Text("\(freshness(result)) · \(evidence(result.spot))")
                                        .font(.caption2).foregroundStyle(.secondary)
                                }
                            }
                        }
                        if model.results.isEmpty { Text("No saved places match these filters.") }
                    }
                    NavigationLink("Quick filters") { filters }
                }
            }
            .navigationTitle("Nearby")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Refresh location", systemImage: "location") { model.refreshLocation() }
                }
            }
        }
        .onChange(of: scenePhase, initial: true) { _, phase in
            if phase == .active { model.refreshLocation() }
        }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                if !Task.isCancelled { model.refreshClock() }
            }
        }
    }

    private var filters: some View {
        List {
            Picker("Tobacco", selection: Binding(
                get: { model.preferences.tobaccoType ?? "any" },
                set: { model.setTobacco($0 == "any" ? nil : $0) }
            )) {
                Text("Any").tag("any")
                Text("Paper").tag("paper")
                Text("Heated").tag("heated")
            }
            Toggle("Confirmed support", isOn: Binding(
                get: { model.preferences.requireConfirmedTobaccoSupport },
                set: { model.setConfirmedTobacco($0) }
            )).disabled(model.preferences.tobaccoType == nil)
            Toggle("Public access", isOn: Binding(
                get: { model.preferences.publicAccessOnly }, set: { model.setPublicOnly($0) }
            ))
            Toggle("Confirmed public", isOn: Binding(
                get: { model.preferences.requireConfirmedPublicAccess },
                set: { model.setConfirmedPublic($0) }
            )).disabled(!model.preferences.publicAccessOnly)
            Picker("Physical type", selection: Binding(
                get: { model.preferences.spotTypes?.count == 1 ? model.preferences.spotTypes![0] :
                    model.preferences.spotTypes == nil ? "any" : "saved" },
                set: { if $0 != "saved" { model.setSpotType($0 == "any" ? nil : $0) } }
            )) {
                Text("Any").tag("any")
                Text("Saved selection").tag("saved")
                Text("Outdoor area").tag("designatedOutdoorArea")
                Text("Public room").tag("publicSmokingRoom")
                Text("Facility room").tag("facilitySmokingRoom")
                Text("Ashtray").tag("ashtray")
                Text("Venue").tag("smokingPermittedVenue")
                Text("Unknown type").tag("unknown")
            }
            Toggle("Confirmed open now", isOn: Binding(
                get: { model.preferences.openNowOnly }, set: { model.setOpenNow($0) }
            ))
            Toggle("Official listing", isOn: Binding(
                get: { model.preferences.officialEvidenceOnly }, set: { model.setOfficialOnly($0) }
            ))
            Picker("Verified within", selection: Binding(
                get: { model.preferences.verifiedWithinDays ?? 0 },
                set: { model.setVerifiedDays($0 == 0 ? nil : $0) }
            )) {
                Text("Any date").tag(0)
                Text("30 days").tag(30)
                Text("90 days").tag(90)
                Text("1 year").tag(365)
            }
            Button("Clear Watch filters") { model.clearFilters() }
        }
        .navigationTitle("Filters")
    }

    private func detail(_ result: WatchRankedSpot) -> some View {
        List {
            Section {
                Text(type(result.spot.spotType))
                if result.distanceMeters.isFinite {
                    Text("\(distance(result.distanceMeters)) straight-line")
                    Text(bearing(result))
                } else {
                    Text("Distance and bearing need Watch location")
                }
                Text("\(freshness(result)) · \(evidence(result.spot))")
                Text("Paper: \(support(result.spot.supportsPaper)) · Heated: \(support(result.spot.supportsHeated))")
                Text("Access: \(access(result.spot.accessType))")
            }
            Section("Source") {
                ForEach(model.snapshot?.sources.filter { result.spot.sourceIDs.contains($0.id) } ?? [], id: \.id) { source in
                    Text(source.displayName)
                    if let attribution = source.attributionText { Text(attribution).font(.footnote) }
                    if let license = source.licenseName { Text(license).font(.footnote) }
                }
                if result.spot.sourceIDs.isEmpty { Text("Source details unavailable") }
            }
            Section {
                if #available(watchOS 11.4, *), let url = WatchNavigation.walkingURL(for: result.spot) {
                    Link("Open walking directions", destination: url)
                }
                Text(WatchNavigation.fallback(hasLocation: result.distanceMeters.isFinite))
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .navigationTitle(name(result.spot))
    }

    private func name(_ spot: WatchSpot) -> String { spot.name ?? type(spot.spotType) }
    private func type(_ value: String) -> String {
        switch value {
        case "designatedOutdoorArea": "Designated outdoor area"
        case "publicSmokingRoom": "Public smoking room"
        case "facilitySmokingRoom": "Facility smoking room"
        case "ashtray": "Ashtray location"
        case "smokingPermittedVenue": "Smoking-permitted venue"
        default: "Unknown physical type"
        }
    }
    private func access(_ value: String) -> String {
        switch value {
        case "public": "Public"
        case "customerOnly": "Customers only"
        case "facilityOnly": "Facility only"
        default: "Unknown"
        }
    }
    private func support(_ value: String) -> String {
        value == "yes" ? "Confirmed" : value == "no" ? "Not supported" : "Unknown"
    }
    private func distance(_ meters: Double) -> String {
        meters < 1_000 ? "\(Int(meters.rounded())) m" :
            "\((meters / 1_000).formatted(.number.precision(.fractionLength(1)))) km"
    }
    private func bearing(_ result: WatchRankedSpot) -> String {
        guard result.distanceMeters > max(model.accuracyMeters ?? 0, 1) else {
            return "Direction uncertain within location accuracy"
        }
        return "\(Int(result.bearingDegrees.rounded()))° clockwise from north"
    }
    private func freshness(_ result: WatchRankedSpot) -> String {
        guard let days = result.verificationAgeDays else { return "Verification date unknown" }
        return days == 0 ? "Verified <1 day ago" : "Verified \(days) days ago"
    }
    private func evidence(_ spot: WatchSpot) -> String {
        spot.evidenceQualityVersion == "evidence-quality.v1" && spot.evidenceQuality == "officialListing"
            ? "Official listing" : "Evidence confidence unknown"
    }
}
