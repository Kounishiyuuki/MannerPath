import MapKit
import SwiftUI
import UIKit

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage("eligibilityNoticeAccepted") private var eligibilityNoticeAccepted = false
    @State private var model = NearbyComposition.makeModel()
    @State private var reportModel = ReportComposition.makeModel()
    @State private var showingReport = false
    @State private var showingQuickConfirm = false
    @AppStorage("nearbyConfirmationTasksHidden") private var nearbyTasksHidden = false
    @State private var path: [String] = []
    @State private var mapRegion: MKCoordinateRegion?
    @State private var mapRegionRequest = 0
    @State private var mapPositionedByUser = false
    @State private var selectedSnapshot: DetailSelection?
    @State private var filters = WatchPreferenceStore.filters(from: WatchPreferenceStore.load())
    @State private var destinationQuery = ""
    @State private var showingEligibility = false
    @State private var showingFilters = false
    @State private var showingNearbySheet = false
    @State private var sheetDetent: PresentationDetent = .medium
    @State private var selectedSpotID: String?
    @FocusState private var searchFocused: Bool

    private static let summaryAnchor = "nearbySheetSummaryAnchor"
    private static let destinationListAnchor = "nearbyDestinationListAnchor"

    // docs/DESIGN.md §5.1–5.5: the map fills the screen and Nearby lives in a standard, non-dismissable sheet over it.
    // The sheet holds its own NavigationStack, so details and every other sheet are presented from inside it.
    var body: some View {
        GeometryReader { proxy in
            nearbyMap(bottomInset: proxy.size.height * 0.5)
        }
        .ignoresSafeArea()
        .sheet(isPresented: $showingNearbySheet) {
            nearbySheet
        }
        .onOpenURL { url in
            guard let parsed = NearbyGlance.spotID(from: url) else { return }
            if model.destination != nil { selectDestination(nil) }
            path = []
            if let id = parsed { path.append(id) }
        }
        .onChange(of: scenePhase, initial: true) { _, phase in
            if phase == .active && eligibilityNoticeAccepted { activateNearby() }
        }
        .fullScreenCover(isPresented: $showingEligibility, onDismiss: { showingNearbySheet = eligibilityNoticeAccepted }) {
            EligibilityNoticeView {
                eligibilityNoticeAccepted = true
                showingEligibility = false
                if scenePhase == .active { activateNearby() }
            }
        }
        .task {
            if eligibilityNoticeAccepted { showingNearbySheet = true } else { showingEligibility = true }
        }
        .onChange(of: mapCenter, initial: true) { _, _ in
            if !mapPositionedByUser { recenterMap() }
        }
        .onChange(of: resultCoordinates) { _, _ in
            if !mapPositionedByUser { recenterMap() }
        }
        .onChange(of: model.destination) { _, _ in
            recenterMap()
        }
        .onChange(of: filters) { _, updated in
            model.setFilters(updated)
            PhoneWatchSync.shared.publish(preferences: WatchPreferenceStore.save(updated))
        }
    }

    private var nearbySheet: some View {
        NavigationStack(path: $path) {
            ScrollViewReader { proxy in
                List {
                    // While a destination search runs or has answers, its results lead the sheet, under the field.
                    if isShowingSearchResults {
                        searchResultsSection
                    }
                    if model.browsingCoordinate == nil {
                        Section { sheetSummary.id(Self.summaryAnchor) }
                    }
                    // Results first, as in Maps: the medium detent shows the summary and the nearest rows; location,
                    // tasks, destination and reporting follow.
                    if model.browsingCoordinate != nil {
                        listSection
                    }
                    Section {
                        locationSection
                    }
                    if model.browsingCoordinate != nil {
                        nearbyTasksSection
                    }
                    destinationSection
                    Section {
                        reportSection
                    }
                }
                .listStyle(.insetGrouped)
                .listSectionSpacing(.compact)
                // Codex P2 (#203): a pin selected while the list is scrolled must not leave its summary off screen.
                .onChange(of: selectedSpotID) { _, id in
                    guard id != nil else { return }
                    withAnimation(reduceMotion ? nil : .default) { proxy.scrollTo(Self.summaryAnchor, anchor: .top) }
                }
                .onChange(of: model.destination) { _, destination in
                    guard destination != nil else { return }
                    withAnimation(reduceMotion ? nil : .default) { proxy.scrollTo(Self.destinationListAnchor, anchor: .top) }
                }
            }
            // docs/DESIGN.md §5.9: the system search field; MapKit search behind it is unchanged (ADR-0001), and the
            // query never reaches MannerPath's backend.
            .searchable(text: $destinationQuery, placement: .navigationBarDrawer(displayMode: .always),
                        prompt: Text("Search a destination in Apple Maps"))
            .searchFocused($searchFocused)
            .onSubmit(of: .search) {
                sheetDetent = .large
                model.searchDestination(destinationQuery)
            }
            // Searching needs the full sheet: at medium the keyboard covers the results. Focus alone is not reported
            // reliably for a drawer search field, so showing results also expands the sheet.
            .onChange(of: searchFocused) { _, focused in
                if focused { sheetDetent = .large }
            }
            .onChange(of: isShowingSearchResults) { _, showing in
                if showing { sheetDetent = .large }
            }
            .navigationTitle("Nearby")
            .navigationBarTitleDisplayMode(.inline)
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
                    Button(model.destination == nil ? "Recenter" : "Recenter on destination",
                           systemImage: "location.north.line") { recenterMap() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink {
                        AboutPrivacyView(sources: model.sources, reportModel: reportModel)
                            // Not a `path` push, so the detent follows here: a full page needs the full sheet.
                            .onAppear { sheetDetent = .large }
                    } label: {
                        Label("Data & Privacy", systemImage: "info.circle")
                    }
                }
            }
            .navigationDestination(for: String.self) { id in
                if let selection = detailSelection(id: id) {
                    SpotDetailView(
                        result: selection.result,
                        locationAccuracyMeters: selection.area.deviceLocation?.horizontalAccuracyMeters ?? 0,
                        estimateFromPreviousLocation: !selection.area.isDestination &&
                            (selection.area.coordinate != model.displayLocation?.coordinate ||
                             selection.area.deviceLocation?.isLastKnown == true),
                        routeOrigin: model.displayLocation?.isLastKnown == false ? model.displayLocation?.coordinate : nil,
                        nearbySources: selection.nearbySources,
                        reportAvailability: reportModel.availability,
                        hasSavedReport: reportModel.draft != nil,
                        distanceFromDestination: selection.area.isDestination,
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
        // System detents only (Codex P2 #203): a fixed small fraction clipped the summary at large text sizes. Medium
        // keeps the map in view and starts with the summary; large holds the full list, search and details.
        .presentationDetents([.medium, .large], selection: $sheetDetent)
        .presentationDragIndicator(.visible)
        .presentationBackgroundInteraction(.enabled(upThrough: .medium))
        .interactiveDismissDisabled()
        .onChange(of: path) { _, newPath in
            // A pushed detail needs the full height; coming back returns to the list over the map.
            sheetDetent = newPath.isEmpty ? .medium : .large
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
            Section {
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
                            .buttonStyle(.borderless)
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
                                    Text("\(SpotPresentation.distance(result)) · \(SpotPresentation.confirmationSummary(result.spot))")
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
        model.resultsArea?.coordinate ?? model.browsingCoordinate
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
        guard let centerCoordinate = mapCenter else { return }
        var minLatitude = centerCoordinate.latitude
        var maxLatitude = minLatitude
        var minLongitudeOffset = 0.0
        var maxLongitudeOffset = 0.0
        for coordinate in resultCoordinates {
            minLatitude = min(minLatitude, coordinate.latitude)
            maxLatitude = max(maxLatitude, coordinate.latitude)
            let offset = (coordinate.longitude - centerCoordinate.longitude + 540)
                .truncatingRemainder(dividingBy: 360) - 180
            minLongitudeOffset = min(minLongitudeOffset, offset)
            maxLongitudeOffset = max(maxLongitudeOffset, offset)
        }
        var centerLongitude = centerCoordinate.longitude +
            (minLongitudeOffset + maxLongitudeOffset) / 2
        if centerLongitude > 180 { centerLongitude -= 360 }
        if centerLongitude < -180 { centerLongitude += 360 }
        mapPositionedByUser = false
        mapRegionRequest += 1
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
        guard let area = model.resultsArea else { return }
        selectedSnapshot = DetailSelection(result: result, area: area, nearbySources: model.sources)
        path.append(result.spot.id)
    }

    private func selectDestination(_ selected: PlaceDestination?) {
        path = []
        selectedSnapshot = nil
        model.selectDestination(selected)
    }

    private func detailSelection(id: String) -> DetailSelection? {
        if let result = model.result(id: id) ?? model.cachedResult(id: id),
           let area = model.resultsArea {
            return DetailSelection(result: result, area: area, nearbySources: model.sources)
        }
        guard model.displayLocation != nil, selectedSnapshot?.result.spot.id == id else { return nil }
        return switch model.dataState {
        case .readingCache, .refreshing, .waitingForLocation: selectedSnapshot
        default: nil
        }
    }

    // Always on screen, with or without results: an empty, offline or denied state is explained in the sheet, never by
    // replacing the map.
    private func nearbyMap(bottomInset: CGFloat) -> some View {
        ClusteredSpotMap(
            pins: model.results.map { result in
                SpotMapPin(id: result.spot.id, title: SpotPresentation.name(result.spot),
                           coordinate: SpotCoordinate(latitude: result.spot.latitude, longitude: result.spot.longitude),
                           existence: result.spot.verification.existenceTier,
                           // ADR-0017: an area-anchor pin says it is approximate to VoiceOver too.
                           accessibilityValue: [SpotPresentation.evidence(result.spot), SpotPresentation.approximateLocationNote(result.spot)]
                               .compactMap { $0 }.joined(separator: ", "))
            },
            user: model.displayLocation.map { location in
                ClusteredSpotMap.Marker(
                    title: location.isLastKnown || location.coordinate != model.displayLocation?.coordinate
                        ? String(localized: "Last location used for distances") : String(localized: "Your location"),
                    coordinate: location.coordinate)
            },
            destination: model.destination.map {
                ClusteredSpotMap.Marker(title: String(localized: "Destination: \($0.name)"), coordinate: $0.coordinate)
            },
            region: mapRegion,
            regionRequest: mapRegionRequest,
            selectedSpotID: selectedResult?.spot.id,
            bottomInset: bottomInset,
            onUserMovedMap: { mapPositionedByUser = true },
            onSelectSpot: { id in
                guard model.results.contains(where: { $0.spot.id == id }) else { return }
                selectedSpotID = id
                path = []
                sheetDetent = .medium
            }
        )
        .accessibilityIdentifier("nearbyMap")
        .accessibilityLabel("Nearby places map")
        .accessibilityHint("Select a pin to see a summary in the Nearby list")
    }

    /// The selected pin, while it is still among the shown results.
    private var selectedResult: NearbyResult? {
        selectedSpotID.flatMap { id in model.results.first { $0.spot.id == id } }
    }

    // What the collapsed sheet shows: the selected place, or the count and nearest place already listed below.
    @ViewBuilder
    private var sheetSummary: some View {
        if let result = selectedResult {
            SelectedSpotSummary(
                result: result,
                locationAccuracyMeters: model.resultsArea?.deviceLocation?.horizontalAccuracyMeters ?? 0,
                onShowDetails: { openDetail(result) },
                onDirections: { AppleMapsHandoff.openWalkingDirections(to: result.spot) },
                onClear: { selectedSpotID = nil }
            )
        } else if model.destination == nil, let nearest = displayResults.first?.nearby {
            VStack(alignment: .leading, spacing: 4) {
                Text("\(model.results.count) places")
                    .font(.headline)
                Text("Nearest: \(SpotPresentation.name(nearest.spot)) · \(SpotPresentation.distance(nearest))")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("nearbySheetSummary")
        }
    }

    private var listSection: some View {
        Section {
            // The summary is the section's first row, not its own section, so the medium detent still reaches the
            // nearest result.
            sheetSummary
                .id(Self.summaryAnchor)
            dataStatus
            if model.destination != nil {
                Text("Straight-line distances and bearings below are from the selected destination, not your device location.")
                    .font(.footnote)
                    .id(Self.destinationListAnchor)
                Button("Refresh", systemImage: "arrow.clockwise") { model.refresh() }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("refreshDestination")
                switch model.routeState {
                case .idle: EmptyView()
                case .loading: Label("Checking walking detours. Saved places remain available below.", systemImage: "figure.walk")
                case .ready: Text("Routed places rank by added walking time. Other nearby places use straight-line distance and may be off your route.")
                case .unavailable:
                    Label { Text(verbatim: model.routeUnavailableDescription) }
                    icon: { Image(systemName: "wifi.exclamationmark") }
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
            } else if let area = model.resultsArea {
                ForEach(displayResults, id: \.nearby.spot.id) { ranked in
                    Button {
                        openDetail(ranked.nearby)
                    } label: {
                        NearbySpotRow(result: ranked.nearby, detourSeconds: ranked.detourSeconds,
                                      routeMode: model.destination != nil,
                                      locationAccuracyMeters: area.deviceLocation?.horizontalAccuracyMeters ?? 0)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("nearbyResultRow")
                    .accessibilityHint("Opens place details")
                }
            }
        } header: {
            Text(model.destination == nil ? "Nearby places" : "Places near your destination")
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
                Text(verbatim: NearbyEmptyStateCopy.description(for: reportModel.availability))
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

    private var isShowingSearchResults: Bool {
        model.searchingDestination || model.destinationSearchFailed || !model.destinationMatches.isEmpty
    }

    private var searchResultsSection: some View {
        Section {
            if model.searchingDestination { ProgressView("Searching destinations…") }
            if model.destinationSearchFailed {
                Text("Destination search unavailable. Saved nearby places remain available.")
                    .font(.footnote)
            }
            ForEach(model.destinationMatches) { match in
                Button {
                    destinationQuery = match.name
                    searchFocused = false
                    selectDestination(match)
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
                    // The whole row selects, not only its text: a plain button's Spacer takes no taps.
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("destinationMatch")
            }
        } header: {
            Text("Walking destination")
        }
    }

    @ViewBuilder
    private var destinationSection: some View {
        if let destination = model.destination {
            Section {
                HStack {
                    Label(destination.name, systemImage: "flag.checkered")
                    Spacer()
                    Button("Clear") { selectDestination(nil) }
                        .buttonStyle(.borderless)
                }
                .font(.subheadline)
            } header: {
                Text("Walking destination")
            } footer: {
                Text("Destination search stays in this screen and is never added to saved smoking places.")
            }
        } else {
            Section {
            } footer: {
                Text("Destination search stays in this screen and is never added to saved smoking places.")
            }
        }
    }

    @ViewBuilder
    private var dataStatus: some View {
        switch model.dataState {
        case .waitingForLocation:
            EmptyView()
        case .readingCache:
            Label(model.results.isEmpty ? "Reading saved nearby places…" :
                    model.destination == nil
                        ? "Updating nearby places; distances use the previous device location…"
                        : "Updating destination places; distances use the selected destination…",
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
                Button("Use My Location") { model.refreshDeviceLocation() }
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
                Button("Try Again") { model.refreshDeviceLocation() }
                    .buttonStyle(.bordered)
            }
        case .usable(let location):
            VStack(alignment: .leading, spacing: 4) {
                adaptiveRowLayout {
                    Text(location.isLastKnown ? "Last device location" : "Device location")
                        .font(.subheadline.weight(.semibold))
                    if !dynamicTypeSize.isAccessibilitySize { Spacer() }
                    if model.destination == nil {
                        Button("Refresh", systemImage: "arrow.clockwise") { model.refresh() }
                            .buttonStyle(.bordered)
                    }
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
    let area: NearbyArea
    let nearbySources: [SpotSource]
}

@MainActor
enum NearbyEmptyStateCopy {
    static func description(for availability: ReportAvailability) -> String {
        if case .available = availability {
            return String(localized: "If you know a smoking place here, you can add it for review.")
        }
        return String(localized: "Coverage varies by area. Only published places are shown.")
    }
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
                Text("\(SpotPresentation.distance(result)) straight-line · \(SpotPresentation.bearing(result, accuracyMeters: locationAccuracyMeters))")
                    .fontWeight(.medium)
                if let note = SpotPresentation.approximateLocationNote(result.spot) {
                    Label(note, systemImage: "mappin.and.ellipse").foregroundStyle(.secondary)
                }
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
        .padding(.vertical, 4)
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
            String(localized: "\(SpotPresentation.distance(result)) straight-line"),
            SpotPresentation.bearing(result, accuracyMeters: locationAccuracyMeters)
        ]
        // ADR-0017: VoiceOver hears that the pin is approximate, as sighted users read it.
        if let note = SpotPresentation.approximateLocationNote(result.spot) { parts.append(note) }
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

/// docs/DESIGN.md §5.5: a tapped pin is summarised in the sheet first; details are one explicit step further.
/// Evidence and the approximate-location note stay separate labels, as in the list row.
private struct SelectedSpotSummary: View {
    let result: NearbyResult
    let locationAccuracyMeters: Double
    let onShowDetails: () -> Void
    let onDirections: () -> Void
    let onClear: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text("Selected place")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                // The frame sits on the label so it is the button's own hit region. 46, not 44: iOS 26 draws a floating
                // (non-large) sheet scaled to its inset width (386/402 on iPhone 17), and 44 pt measured 42.2 pt on screen.
                Button(action: onClear) {
                    Label("Clear selection", systemImage: "xmark.circle.fill")
                        .labelStyle(.iconOnly)
                        .frame(minWidth: 46, minHeight: 46)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.borderless)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("clearSelectedSpot")
            }
            Text(SpotPresentation.name(result.spot))
                .font(.title3.weight(.semibold))
            Text("\(SpotPresentation.distance(result)) straight-line · \(SpotPresentation.bearing(result, accuracyMeters: locationAccuracyMeters))")
                .font(.subheadline)
            Label("\(SpotPresentation.evidence(result.spot)) · \(SpotPresentation.confirmation(result))",
                  systemImage: SpotPresentation.existenceSymbol(result.spot.verification.existenceTier))
                .font(.subheadline)
                .foregroundStyle(.secondary)
            // Location precision is its own line, apart from evidence; the detail view uses the same note.
            if let note = SpotPresentation.approximateLocationNote(result.spot)
                ?? SpotPresentation.locationNote(result.spot.verification.locationPrecision) {
                Label(note, systemImage: "mappin.and.ellipse")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("selectedSpotPrecision")
            }
            // ADR-0017: 「この場所へ案内」 only for an exact point; approximate and unknown precision say 「この付近へ案内」.
            // Black on MannerPath Yellow: white text on #F5A623 is about 2:1, black is about 10:1.
            // Text only, no symbol: 「この場所へ案内」 vs 「この付近へ案内」 is the exact/approximate distinction itself, and an
            // icon beside it truncated the wording at the largest text sizes.
            Button(action: onDirections) {
                Text(SpotPresentation.navigationTitle(result.spot))
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .foregroundStyle(.black)
            }
            .buttonStyle(.borderedProminent)
            .tint(Color("MannerPathYellow"))
            .accessibilityHint("Opens walking directions in Apple Maps")
            .accessibilityIdentifier("selectedSpotDirections")
            Button(action: onShowDetails) {
                Text("Show place details")
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("selectedSpotDetails")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("selectedSpotSummary")
    }
}
