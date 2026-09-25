import SwiftUI

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("watchEligibilityNoticeAccepted") private var eligibilityNoticeAccepted = false
    @State private var model = WatchNearbyModel()

    var body: some View {
        NavigationStack {
            List {
                if !eligibilityNoticeAccepted {
                    Section("Before you continue") {
                        Text("For people legally permitted to smoke. Nearby results do not confirm that smoking is allowed.")
                        Text("In Japan, you must be at least 20 to smoke or enter a smoking area.")
                        Text("Follow posted signs, on-site rules, and local law.")
                            .font(.footnote).foregroundStyle(.secondary)
                        Button("Continue") {
                            eligibilityNoticeAccepted = true
                            model.refreshLocation(requestAuthorization: false)
                        }
                        .accessibilityIdentifier("watch-eligibility-continue")
                    }
                }
                if eligibilityNoticeAccepted && model.snapshot == nil {
                    ContentUnavailableView("No saved places", systemImage: "iphone.and.arrow.forward",
                                           description: Text("Open MannerPath on iPhone once to send nearby data to this Watch."))
                } else if eligibilityNoticeAccepted {
                    Section(model.snapshotIsOld ? "Saved places · old data" : "Saved nearby places") {
                        ForEach(model.results, id: \.spot.id) { result in
                            NavigationLink {
                                detail(result)
                            } label: {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(name(result.spot)).font(.headline)
                                    Text(type(result.spot.spotType)).font(.caption)
                                    Text(result.distanceMeters.isFinite
                                         ? "\(distance(result.distanceMeters)) · current location"
                                         : "Distance needs location")
                                        .font(.caption)
                                    Text(freshness(result))
                                        .font(.caption2).foregroundStyle(.secondary)
                                    if result.spot.evidenceQualityVersion != "evidence-quality.v1" ||
                                        result.spot.evidenceQuality != "officialListing" {
                                        Text(evidence(result.spot))
                                            .font(.caption2).foregroundStyle(.secondary)
                                    }
                                }
                                .accessibilityElement(children: .combine)
                            }
                            .accessibilityHint("Opens place details")
                            .accessibilityIdentifier("watch-spot-\(result.spot.id)")
                        }
                        if model.results.isEmpty {
                            Text("No saved places match these filters.")
                            Button("Clear Watch filters") { model.clearFilters() }
                                .accessibilityIdentifier("watch-clear-empty-filters")
                        }
                    }
                    if model.locationAuthorizationUndetermined {
                        Section("Location") {
                            Text("Use Watch location for distance and direction.")
                                .font(.footnote).foregroundStyle(.secondary)
                            Button("Use Watch Location") { model.refreshLocation() }
                        }
                    } else if model.latitude == nil {
                        Label(model.locationUnavailable
                              ? "Watch location is unavailable. Saved places remain available."
                              : "Finding Watch location. Saved places are shown first.",
                              systemImage: model.locationUnavailable ? "location.slash" : "location")
                            .font(.footnote)
                    }
                    NavigationLink("Quick filters") { filters }
                        .accessibilityIdentifier("watch-quick-filters")
                }
            }
            .navigationTitle("Nearby")
            .toolbar {
                if eligibilityNoticeAccepted {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Refresh location", systemImage: "location") { model.refreshLocation() }
                    }
                }
            }
        }
        .onChange(of: scenePhase, initial: true) { _, phase in
            if phase == .active && eligibilityNoticeAccepted { model.refreshLocation(requestAuthorization: false) }
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
            Section("Tobacco") {
                Picker("Tobacco", selection: Binding(
                    get: { model.preferences.tobaccoType ?? "any" },
                    set: { model.setTobacco($0 == "any" ? nil : $0) }
                )) {
                    Text("Any").tag("any")
                    Text("Paper").tag("paper")
                    Text("Heated").tag("heated")
                }
                .accessibilityIdentifier("watch-tobacco-filter")
                Toggle("Confirmed support", isOn: Binding(
                    get: { model.preferences.requireConfirmedTobaccoSupport },
                    set: { model.setConfirmedTobacco($0) }
                )).disabled(model.preferences.tobaccoType == nil)
                    .accessibilityIdentifier("watch-confirmed-support-filter")
            }
            Section("Place and access") {
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
            }
            Section("Data") {
                Toggle("Confirmed open now", isOn: Binding(
                    get: { model.preferences.openNowOnly }, set: { model.setOpenNow($0) }
                )).accessibilityIdentifier("watch-open-now-filter")
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
            }
            Button("Clear Watch filters") { model.clearFilters() }
                .accessibilityIdentifier("watch-clear-filters")
        }
        .navigationTitle("Filters")
    }

    private func detail(_ result: WatchRankedSpot) -> some View {
        List {
            Section {
                Text(type(result.spot.spotType))
                if result.distanceMeters.isFinite {
                    Text("\(distance(result.distanceMeters)) straight-line · current location")
                    Text(bearing(result))
                } else {
                    Text("Distance and bearing need Watch location")
                }
                Text("\(freshness(result)) · \(evidence(result.spot))")
                if model.snapshotIsOld {
                    Text("Saved data is old. Open iPhone app to refresh.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if #available(watchOS 11.4, *), let url = WatchNavigation.walkingURL(for: result.spot) {
                    Link("Open walking directions", destination: url)
                        .accessibilityIdentifier("watch-directions")
                }
                Text(WatchNavigation.fallback(hasLocation: result.distanceMeters.isFinite))
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Section("Details") {
                Text("Paper: \(support(result.spot.supportsPaper)) · Heated: \(support(result.spot.supportsHeated))")
                Text("Access: \(access(result.spot.accessType))")
                Text("Follow posted signs, on-site rules, and local law. Unknown details are not confirmation.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Section("Source") {
                ForEach(model.snapshot?.sources(for: result.spot) ?? [], id: \.self) { source in
                    Text(source.displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                         ? String(localized: "Source name unavailable") : source.displayName)
                    if let attribution = source.attributionText { Text(attribution).font(.footnote) }
                    if let license = source.licenseName { Text(license).font(.footnote) }
                }
                if result.spot.sourceIDs.isEmpty { Text("Source details unavailable") }
            }
        }
        .navigationTitle(name(result.spot))
    }

    private func name(_ spot: WatchSpot) -> String { spot.name ?? type(spot.spotType) }
    private func type(_ value: String) -> String {
        switch value {
        case "designatedOutdoorArea": String(localized: "Designated outdoor area")
        case "publicSmokingRoom": String(localized: "Public smoking room")
        case "facilitySmokingRoom": String(localized: "Facility smoking room")
        case "ashtray": String(localized: "Ashtray location")
        case "smokingPermittedVenue": String(localized: "Smoking-permitted venue")
        default: String(localized: "Unknown physical type")
        }
    }
    private func access(_ value: String) -> String {
        switch value {
        case "public": String(localized: "Public")
        case "customerOnly": String(localized: "Customers only")
        case "facilityOnly": String(localized: "Facility only")
        default: String(localized: "Unknown")
        }
    }
    private func support(_ value: String) -> String {
        value == "yes" ? String(localized: "Confirmed") : value == "no" ? String(localized: "Not supported") : String(localized: "Unknown")
    }
    private func distance(_ meters: Double) -> String {
        meters < 1_000 ? String(localized: "\(Int(meters.rounded())) m") :
            String(localized: "\((meters / 1_000).formatted(.number.precision(.fractionLength(1)))) km")
    }
    private func bearing(_ result: WatchRankedSpot) -> String {
        guard result.distanceMeters > max(model.accuracyMeters ?? 0, 1) else {
            return String(localized: "Direction uncertain within location accuracy")
        }
        return String(localized: "\(Int(result.bearingDegrees.rounded()))° clockwise from north")
    }
    private func freshness(_ result: WatchRankedSpot) -> String {
        guard let days = result.verificationAgeDays else { return String(localized: "Verification date unknown") }
        if days == 0 { return String(localized: "Verified less than a day ago") }
        if days == 1 { return String(localized: "Verified 1 day ago") }
        return String(localized: "Verified \(days) days ago")
    }
    private func evidence(_ spot: WatchSpot) -> String {
        spot.evidenceQualityVersion == "evidence-quality.v1" && spot.evidenceQuality == "officialListing"
            ? String(localized: "Official listing") : String(localized: "Evidence confidence unknown")
    }
}
