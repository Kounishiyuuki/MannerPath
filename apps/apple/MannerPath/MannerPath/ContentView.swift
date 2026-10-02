import MapKit
import SwiftUI
import UIKit

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @AppStorage("eligibilityNoticeAccepted") private var eligibilityNoticeAccepted = false
    @State private var model = NearbyComposition.makeModel()
    @State private var reportModel = ReportComposition.makeModel()
    @State private var showingReport = false
    @State private var showingQuickConfirm = false
    @AppStorage("nearbyConfirmationTasksHidden") private var nearbyTasksHidden = false
    @State private var path: [String] = []
    @State private var mapRegion: MKCoordinateRegion?
    @State private var mapMovedByUser = false
    @State private var selectedSnapshot: DetailSelection?
    @State private var filters = WatchPreferenceStore.filters(from: WatchPreferenceStore.load())
    @State private var destinationQuery = ""
    @State private var showingEligibility = false
    @State private var showingFilters = false

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    locationSection

                    if model.displayLocation != nil {
                        dataStatus
                        if !model.results.isEmpty { mapSection }
                        listSection
                        nearbyTasksSection
                        destinationSection
                    }

                    reportSection
                }
                .padding()
            }
            .navigationTitle("Nearby")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(filters == NearbyFilters() ? "Filters" : "Filters active",
                           systemImage: "line.3.horizontal.decrease") {
                        showingFilters = true
                    }
                    .accessibilityHint("Adjust nearby result filters")
                }
                ToolbarItem(placement: .bottomBar) {
                    if case .available = reportModel.availability {
                        Button("Add a smoking place", systemImage: "plus.circle") { startAddingPlace() }
                            .disabled(!reportModel.canStartReport)
                            .accessibilityHint("Pin a smoking place that is missing from the map. It is reviewed before it can appear.")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink {
                        AboutPrivacyView(sources: model.sources)
                    } label: {
                        Label("Data & Privacy", systemImage: "info.circle")
                    }
                }
            }
            .navigationDestination(for: String.self) { id in
                if let selection = detailSelection(id: id) {
                    SpotDetailView(
                        result: selection.result,
                        locationAccuracyMeters: selection.location.horizontalAccuracyMeters,
                        estimateFromPreviousLocation: selection.location.coordinate != model.displayLocation?.coordinate ||
                            selection.location.isLastKnown,
                        routeOrigin: !selection.location.isLastKnown &&
                            model.displayLocation?.isLastKnown == false &&
                            selection.location.coordinate == model.displayLocation?.coordinate
                            ? selection.location.coordinate : nil,
                        nearbySources: selection.nearbySources,
                        reportAvailability: reportModel.availability,
                        hasSavedReport: reportModel.draft != nil,
                        onReport: { type in
                            reportModel.start(type: type, spotId: selection.result.spot.id,
                                              subjectName: SpotPresentation.name(selection.result.spot))
                            showingReport = true
                        },
                        onConfirmStillHere: {
                            reportModel.startQuickConfirm(spotId: selection.result.spot.id,
                                                          subjectName: SpotPresentation.name(selection.result.spot))
                            if reportModel.draft?.type == .exists { showingQuickConfirm = true }
                        }
                    )
                } else {
                    ContentUnavailableView("Place no longer in nearby results", systemImage: "mappin.slash")
                }
            }
        }
        .onOpenURL { url in
            guard let parsed = NearbyGlance.spotID(from: url) else { return }
            path = []
            if let id = parsed { path.append(id) }
        }
        .onChange(of: scenePhase, initial: true) { _, phase in
            if phase == .active && eligibilityNoticeAccepted { activateNearby() }
        }
        .sheet(isPresented: $showingReport) {
            ReportFormView(model: reportModel, visualCenter: model.displayLocation?.coordinate,
                           nearbySpots: model.results.map(\.spot))
        }
        .sheet(isPresented: $showingQuickConfirm) {
            QuickConfirmView(model: reportModel)
        }
        .sheet(isPresented: $showingFilters) {
            NavigationStack {
                Form { NearbyFilterView(filters: $filters) }
                    .navigationTitle("Filters")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { showingFilters = false }
                        }
                    }
            }
            .presentationDetents([.medium, .large])
        }
        .fullScreenCover(isPresented: $showingEligibility) {
            EligibilityNoticeView {
                eligibilityNoticeAccepted = true
                showingEligibility = false
                if scenePhase == .active { activateNearby() }
            }
        }
        .task {
            if !eligibilityNoticeAccepted { showingEligibility = true }
        }
        .onChange(of: mapCenter, initial: true) { _, _ in
            if !mapMovedByUser { recenterMap() }
        }
        .onChange(of: resultCoordinates) { _, _ in
            if !mapMovedByUser { recenterMap() }
        }
        .onChange(of: model.destination) { _, _ in
            if !mapMovedByUser { recenterMap() }
        }
        .onChange(of: filters) { _, updated in
            model.setFilters(updated)
            PhoneWatchSync.shared.publish(preferences: WatchPreferenceStore.save(updated))
        }
    }

    private func activateNearby() {
        model.onCachedCorpusChange = { spots, sources, origin in
            PhoneWatchSync.shared.publish(spots: spots, sources: sources, near: origin)
        }
        model.onCachedGlanceChange = { spots, location in
            PhoneGlancePublisher.publish(spots: spots, near: location)
        }
        model.publishCachedCorpusForWatch()
        model.setFilters(filters)
        PhoneWatchSync.shared.publish(preferences: WatchPreferenceStore.load())
        model.start()
        Task { await reportModel.refreshAvailability() }
    }

    private func startAddingPlace() {
        reportModel.startNewSpot(pin: nil)
        showingReport = true
    }

    /// ADR-0013 nearby tasks: a light, ignorable prompt inside the Nearby screen — no push, no streaks, no tracking.
    /// Derived from the results already on screen (coverage-tasks.v1); nothing is sent to find them.
    @ViewBuilder
    private var nearbyTasksSection: some View {
        let waiting = CoverageTasks.nearbyConfirmations(model.results, at: .now)
        if !waiting.isEmpty, case .available = reportModel.availability {
            VStack(alignment: .leading, spacing: 8) {
                if nearbyTasksHidden {
                    Button("Show places waiting for confirmation") { nearbyTasksHidden = false }
                        .font(.footnote)
                } else {
                    HStack {
                        Text("Places nearby waiting for confirmation")
                            .font(.headline)
                            .accessibilityAddTraits(.isHeader)
                        Spacer()
                        Button("Hide") { nearbyTasksHidden = true }
                            .font(.footnote)
                    }
                    Text("If you pass one, you can tell others whether it is still there.")
                        .font(.footnote).foregroundStyle(.secondary)
                    ForEach(waiting, id: \.spot.id) { result in
                        Button {
                            openDetail(result)
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(SpotPresentation.name(result.spot)).font(.subheadline.weight(.semibold))
                                    Text("\(SpotPresentation.distance(result.distanceMeters)) · \(SpotPresentation.confirmationSummary(result.spot))")
                                        .font(.footnote).foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 0)
                                Image(systemName: "chevron.forward").font(.footnote).foregroundStyle(.tertiary)
                                    .accessibilityHidden(true)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("nearbyConfirmationTask")
                    }
                }
            }
        }
    }

    private var mapCenter: SpotCoordinate? {
        (model.resultsLocation ?? model.displayLocation)?.coordinate
    }

    private var adaptiveRowLayout: AnyLayout {
        dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
            : AnyLayout(HStackLayout(spacing: 8))
    }

    @ViewBuilder
    private var reportSection: some View {
        if reportModel.draft != nil {
            Button("Continue saved report") { showingReport = true }
                .buttonStyle(.bordered)
            Text("Review or discard your saved proposal. It stays on this device until submitted or discarded.")
                .font(.footnote).foregroundStyle(.secondary)
        }
        switch reportModel.availability {
        case .available:
            if reportModel.draft == nil {
                Button("Add a smoking place", systemImage: "plus.circle") { startAddingPlace() }
                    .buttonStyle(.bordered)
                Text("Know a smoking place that isn't listed? Pin it and say what is there. It is reviewed before it can appear.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        case .unknown:
            VStack(alignment: .leading, spacing: 8) {
                Text(reportModel.draft == nil
                     ? "Reporting availability could not be checked. Try again when connected."
                     : "Reporting availability is unknown. Your saved draft remains on this device.")
                    .font(.footnote).foregroundStyle(.secondary)
                Button("Check reporting again") { Task { await reportModel.refreshAvailability() } }
                    .buttonStyle(.bordered)
            }
        case .unavailable:
            Text("Reports are currently unavailable.")
                .font(.footnote).foregroundStyle(.secondary)
        case .incompatible:
            Text("Update the app to submit reports.")
                .font(.footnote).foregroundStyle(.secondary)
        case .attestationUnsupported:
            Text("Secure reporting isn't supported on this device.")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }

    private var resultCoordinates: [SpotCoordinate] {
        model.results.map { SpotCoordinate(latitude: $0.spot.latitude, longitude: $0.spot.longitude) } +
            (model.destination.map { [$0.coordinate] } ?? [])
    }

    private func recenterMap() {
        guard let location = model.resultsLocation ?? model.displayLocation else { return }
        var minLatitude = location.coordinate.latitude
        var maxLatitude = minLatitude
        var minLongitudeOffset = 0.0
        var maxLongitudeOffset = 0.0
        for coordinate in resultCoordinates {
            minLatitude = min(minLatitude, coordinate.latitude)
            maxLatitude = max(maxLatitude, coordinate.latitude)
            let offset = (coordinate.longitude - location.coordinate.longitude + 540)
                .truncatingRemainder(dividingBy: 360) - 180
            minLongitudeOffset = min(minLongitudeOffset, offset)
            maxLongitudeOffset = max(maxLongitudeOffset, offset)
        }
        var centerLongitude = location.coordinate.longitude +
            (minLongitudeOffset + maxLongitudeOffset) / 2
        if centerLongitude > 180 { centerLongitude -= 360 }
        if centerLongitude < -180 { centerLongitude += 360 }
        mapMovedByUser = false
        mapRegion = MKCoordinateRegion(
            center: CLLocationCoordinate2D(
                latitude: (minLatitude + maxLatitude) / 2,
                longitude: centerLongitude
            ),
            span: MKCoordinateSpan(
                latitudeDelta: max(0.02, (maxLatitude - minLatitude) * 1.4),
                longitudeDelta: max(0.02, (maxLongitudeOffset - minLongitudeOffset) * 1.4)
            )
        )
    }

    private func openDetail(_ result: NearbyResult) {
        guard let location = model.resultsLocation else { return }
        selectedSnapshot = DetailSelection(result: result, location: location, nearbySources: model.sources)
        path.append(result.spot.id)
    }

    private func detailSelection(id: String) -> DetailSelection? {
        if let result = model.result(id: id) ?? model.cachedResult(id: id),
           let location = model.resultsLocation {
            return DetailSelection(result: result, location: location, nearbySources: model.sources)
        }
        guard model.displayLocation != nil, selectedSnapshot?.result.spot.id == id else { return nil }
        return switch model.dataState {
        case .readingCache, .refreshing, .waitingForLocation: selectedSnapshot
        default: nil
        }
    }

    private var mapLocationLabel: String {
        guard let location = model.resultsLocation ?? model.displayLocation else { return String(localized: "Your location") }
        return location.isLastKnown || location.coordinate != model.displayLocation?.coordinate
            ? String(localized: "Last location used for distances") : String(localized: "Your location")
    }

    private var mapSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Map")
                    .font(.headline)
                Spacer()
                Button("Recenter", systemImage: "location.north.line") { recenterMap() }
                    .buttonStyle(.bordered)
            }
            // MapKit native clustering (Issue #158): a dense area draws cluster markers instead of thousands of
            // overlapping pins. Presentation only; the list below and every ranking/filter are unchanged.
            ClusteredSpotMap(
                items: SpotMapItem.items(
                    results: model.results,
                    location: model.resultsLocation ?? model.displayLocation,
                    locationLabel: mapLocationLabel,
                    destination: model.destination.map { (name: $0.name, coordinate: $0.coordinate) }
                ),
                region: mapRegion,
                onSelectSpot: { id in
                    if let result = model.results.first(where: { $0.spot.id == id }) { openDetail(result) }
                },
                onUserMovedMap: { mapMovedByUser = true }
            )
            .frame(height: 240)
            // No container label: on a UIKit-backed view it would merge the pins into one element and hide them
            // from VoiceOver. Each pin and cluster carries its own label (ClusteredSpotMap).
            .accessibilityIdentifier("nearbyMap")
        }
    }

    private var listSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(model.destination == nil ? "Nearby places" : "Nearby places for your walk")
                .font(.title3.weight(.semibold))
                .accessibilityAddTraits(.isHeader)
            if model.destination != nil {
                switch model.routeState {
                case .idle: EmptyView()
                case .loading: Label("Checking walking detours. Saved places remain available below.", systemImage: "figure.walk")
                case .ready: Text("Routed places rank by added walking time. Other nearby places use straight-line distance and may be off your route.")
                case .unavailable:
                    Label(model.resultsLocation?.isLastKnown == true
                          ? "A current location is needed for walking detours. Showing straight-line distance and bearing."
                          : "Walking routes unavailable. Showing saved places by straight-line distance and bearing.",
                          systemImage: "wifi.exclamationmark")
                }
            }
            if model.results.isEmpty {
                if model.hasUnfilteredResults {
                    ContentUnavailableView("No places match these filters", systemImage: "line.3.horizontal.decrease.circle")
                    Button("Clear filters") { filters = NearbyFilters() }
                        .buttonStyle(.bordered)
                } else {
                    unfilteredEmptyState
                }
            } else if let location = model.resultsLocation {
                ForEach(displayResults, id: \.nearby.spot.id) { ranked in
                    Button {
                        openDetail(ranked.nearby)
                    } label: {
                        NearbySpotRow(result: ranked.nearby, detourSeconds: ranked.detourSeconds,
                                      routeMode: model.destination != nil,
                                      locationAccuracyMeters: location.horizontalAccuracyMeters)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("nearbyResultRow")
                    .accessibilityHint("Opens place details")
                }
            }
        }
    }

    @ViewBuilder
    private var unfilteredEmptyState: some View {
        switch model.dataState {
        case .readingCache, .refreshing:
            ProgressView("Loading nearby places…")
                .frame(maxWidth: .infinity, minHeight: 100)
        case .cacheUnavailable:
            ContentUnavailableView("Saved nearby data unavailable", systemImage: "externaldrive.badge.exclamationmark")
        case .refreshed:
            ContentUnavailableView {
                Label("No published spots in this nearby area", systemImage: "mappin.slash")
            } description: {
                Text("If you know a smoking place here, you can add it for review.")
            } actions: {
                if case .available = reportModel.availability, reportModel.canStartReport {
                    Button("Add a smoking place", systemImage: "plus.circle") { startAddingPlace() }
                        .buttonStyle(.bordered)
                }
            }
        case .refreshFailed:
            ContentUnavailableView("Could not load nearby data", systemImage: "wifi.exclamationmark",
                                   description: Text("No saved places are available. Published places may still exist nearby."))
        case .cacheOnly:
            ContentUnavailableView("No saved places nearby", systemImage: "mappin.slash",
                                   description: Text("Live updates are unavailable."))
        case .waitingForLocation:
            EmptyView()
        }
    }

    private var displayResults: [RouteRankedResult] {
        model.destination == nil
            ? RouteDetourRanker.rank(model.results, detours: [:])
            : model.routeResults
    }

    private var destinationSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Walking destination").font(.title3.weight(.semibold))
                .accessibilityAddTraits(.isHeader)
            adaptiveRowLayout {
                TextField("Search a destination in Apple Maps", text: $destinationQuery)
                    .textFieldStyle(.roundedBorder)
                    .submitLabel(.search)
                    .onSubmit { model.searchDestination(destinationQuery) }
                Button("Search") { model.searchDestination(destinationQuery) }
                    .buttonStyle(.bordered)
            }
            if model.searchingDestination { ProgressView("Searching destinations…") }
            if model.destinationSearchFailed {
                Text("Destination search unavailable. Saved nearby places remain available.")
                    .font(.footnote)
            }
            ForEach(model.destinationMatches) { match in
                Button {
                    destinationQuery = match.name
                    model.selectDestination(match)
                } label: {
                    HStack {
                        Image(systemName: "mappin")
                        VStack(alignment: .leading) {
                            Text(match.name)
                            if let subtitle = match.subtitle, subtitle != match.name {
                                Text(subtitle).font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                    }
                }
                .buttonStyle(.plain)
            }
            if let destination = model.destination {
                HStack {
                    Label(destination.name, systemImage: "flag.checkered")
                    Spacer()
                    Button("Clear") { model.selectDestination(nil) }
                }
                .font(.subheadline)
            }
            Text("Destination search stays in this screen and is never added to saved smoking places.")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var dataStatus: some View {
        switch model.dataState {
        case .waitingForLocation:
            EmptyView()
        case .readingCache:
            Label(model.results.isEmpty ? "Reading saved nearby places…" :
                    "Updating nearby places; distances use the previous device location…",
                  systemImage: "internaldrive")
        case .refreshing:
            Label("Showing saved places; refreshing…", systemImage: "arrow.clockwise")
        case .refreshed:
            Text("Nearby data refreshed.")
        case .refreshFailed:
            // The empty state below already explains a failure with nothing saved.
            if !model.results.isEmpty || model.hasUnfilteredResults {
                Text("Some nearby data could not be loaded or refreshed. Saved results remain available where possible.")
            }
        case .cacheOnly:
            Text("Showing saved nearby data. Live updates are unavailable.")
        case .cacheUnavailable:
            Text("Saved nearby data is unavailable on this device.")
        }
    }

    @ViewBuilder
    private var locationSection: some View {
        switch model.locationState {
        case .notDetermined:
            VStack(alignment: .leading, spacing: 12) {
                Text("Use your location to rank nearby permitted places by straight-line distance.")
                Button("Use My Location") { model.refresh() }
                    .buttonStyle(.borderedProminent)
            }
        case .locating:
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 12) {
                    ProgressView()
                    Text("Finding your location…")
                }
                if model.displayLocation != nil {
                    Text("Showing results from your last device location until this updates.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        case .denied:
            VStack(alignment: .leading, spacing: 12) {
                locationMessage("Location access is off. Allow While Using the App access in Settings to rank nearby places.")
                Button("Open Settings", systemImage: "gear") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                }
                .buttonStyle(.bordered)
            }
        case .restricted:
            locationMessage("Location access is restricted on this device.")
        case .unavailable:
            VStack(alignment: .leading, spacing: 12) {
                locationMessage("Location could not be determined. Try again.")
                Button("Try Again") { model.refresh() }
                    .buttonStyle(.bordered)
            }
        case .usable(let location):
            VStack(alignment: .leading, spacing: 4) {
                adaptiveRowLayout {
                    Text(location.isLastKnown ? "Last device location" : "Device location")
                        .font(.subheadline.weight(.semibold))
                    if !dynamicTypeSize.isAccessibilitySize { Spacer() }
                    Button("Refresh", systemImage: "arrow.clockwise") { model.refresh() }
                        .buttonStyle(.bordered)
                }
                Text("Updated \(location.timestamp.formatted(date: .abbreviated, time: .shortened)) · about \(Int(location.horizontalAccuracyMeters.rounded())) m accuracy")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if location.isApproximate || location.horizontalAccuracyMeters > 100 {
                    Text("Location is approximate; distances may be inaccurate.")
                        .font(.footnote)
                }
            }
        }
    }

    private func locationMessage(_ message: LocalizedStringKey) -> some View {
        Text(message)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct DetailSelection {
    let result: NearbyResult
    let location: DeviceLocation
    let nearbySources: [SpotSource]
}

private struct NearbySpotRow: View {
    let result: NearbyResult
    let detourSeconds: TimeInterval?
    let routeMode: Bool
    let locationAccuracyMeters: Double

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(SpotPresentation.name(result.spot))
                    .font(.headline)
                Text(typeLine)
                Text("\(SpotPresentation.distance(result.distanceMeters)) straight-line · \(SpotPresentation.bearing(result, accuracyMeters: locationAccuracyMeters))")
                    .fontWeight(.medium)
                if let detourSeconds {
                    Text("About \(Int((detourSeconds / 60).rounded())) min added walking time")
                        .fontWeight(.semibold)
                } else if routeMode {
                    Text("Walking detour unconfirmed · straight-line fallback")
                        .foregroundStyle(.secondary)
                }
                Label("\(SpotPresentation.evidence(result.spot)) · \(SpotPresentation.confirmation(result))",
                      systemImage: SpotPresentation.existenceSymbol(result.spot.verification.existenceTier))
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.forward")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.tertiary)
                .accessibilityHidden(true)
        }
        .font(.subheadline)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(SpotPresentation.name(result.spot))
        .accessibilityValue(accessibilitySummary)
    }

    // Type, host (when stated) and access: what the place is, where, and who may use it.
    private var typeLine: String {
        [SpotPresentation.type(result.spot), SpotPresentation.host(result.spot.hostType),
         String(localized: "Access: \(SpotPresentation.access(result.spot))")]
            .compactMap { $0 }.joined(separator: " · ")
    }

    private var accessibilitySummary: String {
        var parts = [
            SpotPresentation.type(result.spot),
            String(localized: "Access: \(SpotPresentation.access(result.spot))"),
            String(localized: "\(SpotPresentation.distance(result.distanceMeters)) straight-line"),
            SpotPresentation.bearing(result, accuracyMeters: locationAccuracyMeters)
        ]
        if let detourSeconds {
            let minutes = Int((detourSeconds / 60).rounded())
            parts.append(minutes == 1 ? String(localized: "About 1 minute added walking time")
                        : String(localized: "About \(minutes) minutes added walking time"))
        } else if routeMode {
            parts.append(String(localized: "Walking detour unconfirmed; straight-line fallback"))
        }
        parts.append(SpotPresentation.evidence(result.spot))
        parts.append(SpotPresentation.confirmation(result))
        return parts.joined(separator: ", ")
    }
}
