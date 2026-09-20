import MapKit
import SwiftUI

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var model = NearbyComposition.makeModel()
    @State private var path: [String] = []
    @State private var mapPosition: MapCameraPosition = .automatic
    @State private var selectedSnapshot: DetailSelection?

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("喫煙が認められる年齢の方のみご利用ください。現地のルールに従ってください。\nFor adults of legal smoking age. Follow local rules.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    locationSection

                    if model.displayLocation != nil {
                        dataStatus
                        if !model.results.isEmpty { mapSection }
                        listSection
                    }
                }
                .padding()
            }
            .navigationTitle("Nearby")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink {
                        NearbyAttributionView(sources: model.sources)
                    } label: {
                        Label("Sources", systemImage: "doc.text")
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
                        nearbySources: selection.nearbySources
                    )
                } else {
                    ContentUnavailableView("Place no longer in nearby results", systemImage: "mappin.slash")
                }
            }
        }
        .onChange(of: scenePhase, initial: true) { _, phase in
            if phase == .active { model.start() }
        }
        .onChange(of: mapCenter, initial: true) { _, _ in
            if !mapPosition.positionedByUser { recenterMap() }
        }
        .onChange(of: resultCoordinates) { _, _ in
            if !mapPosition.positionedByUser { recenterMap() }
        }
    }

    private var mapCenter: SpotCoordinate? {
        (model.resultsLocation ?? model.displayLocation)?.coordinate
    }

    private var resultCoordinates: [SpotCoordinate] {
        model.results.map { SpotCoordinate(latitude: $0.spot.latitude, longitude: $0.spot.longitude) }
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
        mapPosition = .region(MKCoordinateRegion(
            center: CLLocationCoordinate2D(
                latitude: (minLatitude + maxLatitude) / 2,
                longitude: centerLongitude
            ),
            span: MKCoordinateSpan(
                latitudeDelta: max(0.02, (maxLatitude - minLatitude) * 1.4),
                longitudeDelta: max(0.02, (maxLongitudeOffset - minLongitudeOffset) * 1.4)
            )
        ))
    }

    private func openDetail(_ result: NearbyResult) {
        guard let location = model.resultsLocation else { return }
        selectedSnapshot = DetailSelection(result: result, location: location, nearbySources: model.sources)
        path.append(result.spot.id)
    }

    private func detailSelection(id: String) -> DetailSelection? {
        if let result = model.result(id: id), let location = model.resultsLocation {
            return DetailSelection(result: result, location: location, nearbySources: model.sources)
        }
        guard model.displayLocation != nil, selectedSnapshot?.result.spot.id == id else { return nil }
        return switch model.dataState {
        case .readingCache, .refreshing, .waitingForLocation: selectedSnapshot
        default: nil
        }
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
            Map(position: $mapPosition) {
                if let location = model.resultsLocation ?? model.displayLocation {
                    Annotation(location.isLastKnown || location.coordinate != model.displayLocation?.coordinate
                               ? "Last location used for distances" : "Your location", coordinate: CLLocationCoordinate2D(
                        latitude: location.coordinate.latitude,
                        longitude: location.coordinate.longitude
                    )) {
                        Image(systemName: "location.circle.fill")
                            .font(.title)
                            .foregroundStyle(.blue)
                            .accessibilityLabel(location.isLastKnown || location.coordinate != model.displayLocation?.coordinate
                                                ? "Last location used for distances" : "Your location")
                    }
                }
                ForEach(model.results, id: \.spot.id) { result in
                    Annotation(
                        SpotPresentation.name(result.spot),
                        coordinate: CLLocationCoordinate2D(
                            latitude: result.spot.latitude,
                            longitude: result.spot.longitude
                        )
                    ) {
                        Button {
                            openDetail(result)
                        } label: {
                            Image(systemName: "mappin.circle.fill")
                                .font(.title)
                                .foregroundStyle(.red)
                                .background(.white, in: Circle())
                                .frame(minWidth: 44, minHeight: 44)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Show details for \(SpotPresentation.name(result.spot))")
                    }
                }
            }
            .frame(height: 320)
        }
    }

    private var listSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Nearby places")
                .font(.headline)
            if model.results.isEmpty {
                switch model.dataState {
                case .readingCache, .refreshing:
                    ProgressView("Loading nearby places…")
                        .frame(maxWidth: .infinity, minHeight: 100)
                case .cacheUnavailable:
                    ContentUnavailableView("Saved nearby data unavailable", systemImage: "externaldrive.badge.exclamationmark")
                case .refreshed:
                    ContentUnavailableView("No published spots in this nearby area", systemImage: "mappin.slash")
                case .refreshFailed:
                    ContentUnavailableView("Could not load nearby data", systemImage: "wifi.exclamationmark",
                                           description: Text("No saved places are available. Published places may still exist nearby."))
                case .cacheOnly:
                    ContentUnavailableView("No saved places nearby", systemImage: "mappin.slash",
                                           description: Text("Live updates are not configured."))
                case .waitingForLocation:
                    EmptyView()
                }
            } else if let location = model.resultsLocation {
                ForEach(model.results, id: \.spot.id) { result in
                    Button {
                        openDetail(result)
                    } label: {
                        NearbySpotRow(result: result, locationAccuracyMeters: location.horizontalAccuracyMeters)
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Opens place details")
                }
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
                    "Updating nearby places; distances use the previous device location…",
                  systemImage: "internaldrive")
        case .refreshing:
            Label("Showing saved places; refreshing…", systemImage: "arrow.clockwise")
        case .refreshed:
            Text("Nearby data refreshed.")
        case .refreshFailed:
            Text("Some nearby data could not be loaded or refreshed. Saved results remain available where possible.")
        case .cacheOnly:
            Text("Showing saved nearby data. Live updates are not configured.")
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
            locationMessage("Location access is off. Check Location Services and this app's While Using the App permission in Settings.")
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
                HStack {
                    Text(location.isLastKnown ? "Last device location" : "Device location")
                        .font(.subheadline.weight(.semibold))
                    Spacer()
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

    private func locationMessage(_ message: String) -> some View {
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
    let locationAccuracyMeters: Double

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(SpotPresentation.name(result.spot))
                    .font(.headline)
                Text("\(SpotPresentation.type(result.spot.spotType)) · \(SpotPresentation.access(result.spot.accessType))")
                Text("\(SpotPresentation.distance(result.distanceMeters)) straight-line · \(SpotPresentation.bearing(result, accuracyMeters: locationAccuracyMeters))")
                    .fontWeight(.medium)
                Text("Last verified: \(SpotPresentation.verificationDate(result.spot.lastVerifiedAt)) · \(SpotPresentation.evidence(result.spot.verification.evidenceQuality))")
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.secondary)
        }
        .font(.subheadline)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
    }
}
