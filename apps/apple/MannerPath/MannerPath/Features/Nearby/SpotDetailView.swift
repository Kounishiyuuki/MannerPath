import MapKit
import SwiftUI

struct SpotDetailView: View {
    let result: NearbyResult
    let locationAccuracyMeters: Double
    let estimateFromPreviousLocation: Bool
    let routeOrigin: SpotCoordinate?
    let nearbySources: [SpotSource]
    let reportAvailability: ReportAvailability
    let hasSavedReport: Bool
    let onReport: () -> Void

    @State private var previewRouter = MapKitWalkingRouter()
    @State private var previewRoute: WalkingRoute?
    @State private var previewLoading = false
    @State private var previewUnavailable = false

    private var spot: Spot { result.spot }

    var body: some View {
        Form {
            Section {
                Text(SpotPresentation.name(spot))
                    .font(.title2.bold())
                    .accessibilityAddTraits(.isHeader)
                LabeledContent("Physical type", value: SpotPresentation.type(spot.spotType))
                LabeledContent("Straight-line distance", value: SpotPresentation.distance(result.distanceMeters))
                detailText("Bearing", SpotPresentation.bearing(result, accuracyMeters: locationAccuracyMeters))
            } footer: {
                Text(estimateFromPreviousLocation
                     ? "Distance and bearing use a previous device location while nearby data updates. They are not a walking route."
                     : "Distance and bearing are estimates from your device location, not a walking route.")
            }

            Section("Walking directions") {
                if let previewRoute {
                    if previewRoute.geometry.count > 1 {
                        Map {
                            MapPolyline(coordinates: previewRoute.geometry.map {
                                CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
                            })
                            .stroke(.blue, lineWidth: 5)
                            Annotation("Place", coordinate: CLLocationCoordinate2D(
                                latitude: spot.latitude, longitude: spot.longitude
                            )) { Image(systemName: "mappin.circle.fill").foregroundStyle(.red) }
                        }
                        .frame(height: 220)
                    }
                    LabeledContent("Walking time", value: "About \(Int((previewRoute.travelTime / 60).rounded())) min")
                    LabeledContent("Walking distance", value: SpotPresentation.distance(previewRoute.distanceMeters))
                } else if previewLoading {
                    ProgressView("Finding a pedestrian route…")
                } else {
                    Text(previewUnavailable
                         ? "Walking route unavailable. The straight-line distance and bearing above remain available."
                         : "A current device location is needed for a walking preview. The straight-line estimate remains available.")
                        .foregroundStyle(.secondary)
                }
                Button {
                    AppleMapsHandoff.openWalkingDirections(to: spot)
                } label: {
                    Label("Open walking directions in Apple Maps", systemImage: "map")
                }
            }

            Section("Use and access") {
                LabeledContent("Paper tobacco", value: SpotPresentation.tobacco(spot.supportsPaper))
                LabeledContent("Heated tobacco", value: SpotPresentation.tobacco(spot.supportsHeated))
                LabeledContent("Access", value: SpotPresentation.access(spot.accessType))
                LabeledContent("Environment", value: SpotPresentation.environment(spot.environment))
                if let floor = spot.floor, !floor.isEmpty {
                    LabeledContent("Floor", value: floor)
                }
                if let note = spot.entranceNote, !note.isEmpty {
                    detailText("Entrance note", note)
                }
            }

            Section {
                LabeledContent("Hours state", value: SpotPresentation.hoursState(spot.openingHours))
                TimelineView(.periodic(from: .now, by: 60)) { context in
                    LabeledContent("Open now", value: openNowText(at: context.date))
                }
                detailText("Source notes", spot.openingHours?.raw ?? "Unknown")
                if let hours = spot.openingHours, hours.status == .parsed,
                   let parsed = hours.parsed {
                    LabeledContent("Reported schedule", value: schedule(parsed))
                    LabeledContent("Time zone", value: hours.timeZone)
                }
            } header: {
                Text("Opening hours")
            } footer: {
                Text("Based on reported hours when available. Follow on-site rules and signs.")
            }

            Section("Evidence and freshness") {
                LabeledContent("Evidence quality", value: SpotPresentation.evidence(spot.verification.evidenceQuality,
                                                                                   version: spot.verification.evidenceQualityVersion))
                LabeledContent("Last verified", value: SpotPresentation.verificationDate(spot.lastVerifiedAt))
                LabeledContent("Freshness", value: SpotPresentation.freshness(result))
                detailText("Sources", SpotPresentation.sourceNames(spot))
                NavigationLink(spot.verification.sources == nil
                               ? "All nearby cached source attributions"
                               : "Source and legal attribution") {
                    NearbyAttributionView(sources: spot.verification.sources ?? nearbySources)
                }
            }

            Section("Suggest a correction") {
                switch reportAvailability {
                case .available:
                    Button(hasSavedReport ? "Continue saved report" : "Report information about this place", action: onReport)
                    if hasSavedReport {
                        Text("The saved report may concern another place. Review its details before submitting.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                case .unknown:
                    Text("Report availability could not be checked. Try again when connected.")
                        .foregroundStyle(.secondary)
                case .unavailable:
                    Text("Reports are currently unavailable.")
                        .foregroundStyle(.secondary)
                case .incompatible:
                    Text("Update the app to submit reports.")
                        .foregroundStyle(.secondary)
                case .attestationUnsupported:
                    Text("This device cannot meet this server's security requirement for reports.")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("Place details")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: previewKey) { await loadPreview() }
        .onDisappear { previewRouter.cancel() }
    }

    private var previewKey: String {
        "\(spot.id)|\(routeOrigin?.latitude.description ?? "none")|\(routeOrigin?.longitude.description ?? "none")"
    }

    private func openNowText(at date: Date) -> String {
        switch NearbySearch.openNow(spot.openingHours, at: date) {
        case .yes: String(localized: "Reported open")
        case .no: String(localized: "Reported closed")
        case .unknown: String(localized: "Unknown")
        }
    }

    private func loadPreview() async {
        previewRouter.cancel()
        previewRoute = nil
        previewUnavailable = false
        guard let routeOrigin else {
            previewLoading = false
            return
        }
        previewLoading = true
        do {
            let route = try await previewRouter.route(
                from: routeOrigin,
                to: SpotCoordinate(latitude: spot.latitude, longitude: spot.longitude)
            )
            guard !Task.isCancelled else { return }
            previewRoute = route
        } catch {
            guard !Task.isCancelled else { return }
            previewUnavailable = true
        }
        previewLoading = false
    }

    private func schedule(_ parsed: SpotParsedOpeningHours) -> String {
        switch parsed.kind {
        case .allDay: String(localized: "Reported all day")
        case .daily:
            if let opens = parsed.opens, let closes = parsed.closes {
                String(localized: "Daily \(opens)–\(closes)")
            } else {
                String(localized: "Daily schedule incomplete")
            }
        case .unsupported: String(localized: "Unsupported schedule")
        }
    }

    private func detailText(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Text(value)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
    }
}
