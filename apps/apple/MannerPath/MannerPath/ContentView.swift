import SwiftUI

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var model = NearbyModel.live()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("喫煙が認められる年齢の方のみご利用ください。現地のルールに従ってください。\nFor adults of legal smoking age. Follow local rules.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)

                    Text("Synthetic demo data near Tokyo Station. Locations are not verified for real-world use.")
                        .font(.subheadline)
                        .padding()
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.yellow.opacity(0.18), in: RoundedRectangle(cornerRadius: 12))

                    locationSection

                    if !model.fixtureAvailable {
                        ContentUnavailableView("Demo data unavailable", systemImage: "tray")
                    } else if case .usable = model.locationState {
                        if model.results.isEmpty {
                            ContentUnavailableView("No confirmed fixture spots", systemImage: "mappin.slash")
                        } else {
                            VStack(alignment: .leading, spacing: 12) {
                                Text("Fixture results")
                                    .font(.headline)
                                ForEach(model.results, id: \.spot.id) { result in
                                    if case .usable(let location) = model.locationState {
                                        NearbySpotRow(result: result, locationAccuracyMeters: location.horizontalAccuracyMeters)
                                    }
                                }
                            }
                        }
                    }
                }
                .padding()
            }
            .navigationTitle("Nearby")
        }
        .onChange(of: scenePhase, initial: true) { _, phase in
            if phase == .active { model.start() }
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
            HStack(spacing: 12) {
                ProgressView()
                Text("Finding your location…")
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
            VStack(alignment: .leading, spacing: 8) {
                Text(location.isLastKnown ? "Using last device location" : "Using device location")
                    .font(.headline)
                Text("Location time: \(location.timestamp.formatted(date: .abbreviated, time: .shortened))")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Text("Location accuracy: about \(Int(location.horizontalAccuracyMeters.rounded())) m")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if location.isApproximate || location.horizontalAccuracyMeters > 100 {
                    Text("Location is approximate; distances may be inaccurate.")
                        .font(.footnote)
                }
                Button("Refresh Location") { model.refresh() }
                    .buttonStyle(.bordered)
            }
        }
    }

    private func locationMessage(_ message: String) -> some View {
        Text(message)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct NearbySpotRow: View {
    let result: NearbyResult
    let locationAccuracyMeters: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(result.spot.name ?? result.spot.spotType.label)
                .font(.headline)
            Text("\(result.spot.spotType.label) · \(result.spot.accessType.label)")
            Text(result.distanceMeters > max(locationAccuracyMeters, 1)
                 ? "\(result.distanceMeters.distanceLabel) straight-line estimate · \(Int(result.bearingDegrees.rounded()))° bearing"
                 : "\(result.distanceMeters.distanceLabel) straight-line estimate · Bearing uncertain within location accuracy")
                .fontWeight(.medium)
            Text("Paper (fixture): \(result.spot.supportsPaper.label) · Heated (fixture): \(result.spot.supportsHeated.label)")
            Text(result.spot.lastVerifiedAt.map {
                "Fixture observation date \($0.formatted(date: .abbreviated, time: .omitted))"
            } ?? "Fixture observation date unknown")
            Text("Evidence quality: \(result.spot.verification.evidenceQuality ?? "unknown")")
            Text("Source: \(result.spot.verification.sourceDisplayNames.joined(separator: ", "))")
        }
        .font(.subheadline)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
    }
}

private extension SpotType {
    var label: String {
        switch self {
        case .designatedOutdoorArea: "Designated outdoor area"
        case .publicSmokingRoom: "Public smoking room"
        case .facilitySmokingRoom: "Facility smoking room"
        case .ashtray: "Ashtray location"
        case .smokingPermittedVenue: "Smoking-permitted venue"
        case .unknown: "Spot type unknown"
        case .unsupported: "Spot type unsupported"
        }
    }
}

private extension AccessType {
    var label: String {
        switch self {
        case .public: "Public access"
        case .customerOnly: "Customers only"
        case .facilityOnly: "Facility access only"
        case .unknown: "Access unknown"
        }
    }
}

private extension TriState {
    var label: String {
        switch self {
        case .yes: "confirmed"
        case .no: "not supported"
        case .unknown: "unknown"
        }
    }
}

private extension Double {
    var distanceLabel: String {
        if self < 1 { return "<1 m" }
        if self < 1_000 { return "\(Int(rounded())) m" }
        return "\((self / 1_000).formatted(.number.precision(.fractionLength(1)))) km"
    }
}
