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
    var distanceFromDestination = false
    /// ADR-0013: start a structured report of this type about this place.
    let onReport: (ReportType) -> Void
    /// ADR-0013 one-tap "it was here".
    let onConfirmStillHere: () -> Void

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
                LabeledContent("Physical type", value: SpotPresentation.type(spot))
                if let host = SpotPresentation.host(spot.hostType) {
                    LabeledContent("Located at", value: host)
                }
                LabeledContent("Straight-line distance", value: SpotPresentation.distance(result))
                if spot.verification.isAreaApproximate {
                    // ADR-0017: the place is confirmed inside the area; the pin is only an approximate marker.
                    Label(ApproximateLocation.detailNote(), systemImage: "mappin.and.ellipse")
                        .font(.footnote)
                        .accessibilityIdentifier("approximate-location-note")
                }
                detailText("Bearing", SpotPresentation.bearing(result, accuracyMeters: locationAccuracyMeters))
            } footer: {
                Text(distanceFromDestination
                     ? "Distance and bearing are estimates from the selected destination, not your device location or a walking route."
                     : estimateFromPreviousLocation
                     ? "Distance and bearing are estimates from a previous device location, not a walking route."
                     : "Distance and bearing are estimates from your device location, not a walking route.")
            }

            Section {
                Label(SpotPresentation.confirmationSummary(spot), systemImage: SpotPresentation.existenceSymbol(spot.verification.existenceTier))
                    .font(.headline)
                Text(SpotPresentation.confirmation(result))
                    .foregroundStyle(.secondary)
                if case .available = reportAvailability {
                    Button {
                        onConfirmStillHere()
                    } label: {
                        Label("It was here", systemImage: "checkmark.circle")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(hasSavedReport)
                    .accessibilityHint("Sends a confirmation that this place still exists, for review")
                    Menu {
                        ForEach(ReportType.corrections(acceptsFindings: acceptsFindings), id: \.self) { type in
                            Button(type.title) { onReport(type) }
                        }
                    } label: {
                        Label("Something is different", systemImage: "exclamationmark.bubble")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .disabled(hasSavedReport)
                }
            } header: {
                Text("On-site check")
            } footer: {
                Text(hasSavedReport
                     ? "Finish or discard your saved report first."
                     : "Been here recently? Your check helps others. It is reviewed before anything changes.")
            }

            Section("Walking directions") {
                if let previewRoute {
                    if previewRoute.geometry.count > 1 {
                        Map {
                            MapPolyline(coordinates: previewRoute.geometry.map {
                                CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
                            })
                            .stroke(.blue, lineWidth: 5)
                            Annotation(String(localized: "Place"), coordinate: CLLocationCoordinate2D(
                                latitude: spot.latitude, longitude: spot.longitude
                            )) { Image(systemName: "mappin.circle.fill").foregroundStyle(.red) }
                        }
                        .frame(height: 220)
                    }
                    LabeledContent("Walking time", value: previewRoute.travelTime < 60
                                   ? String(localized: "Less than 1 min")
                                   : String(localized: "About \(Int((previewRoute.travelTime / 60).rounded())) min"))
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
                    Label(SpotPresentation.navigationTitle(spot), systemImage: "map")
                }
                .accessibilityHint("Opens walking directions in Apple Maps")
                .accessibilityIdentifier("open-walking-directions")
            }

            Section("Use and access") {
                LabeledContent("Paper tobacco", value: SpotPresentation.tobacco(spot.supportsPaper))
                LabeledContent("Heated tobacco", value: SpotPresentation.tobacco(spot.supportsHeated))
                LabeledContent("Access", value: SpotPresentation.access(spot))
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
                detailText("Source notes", spot.openingHours?.raw ?? String(localized: "Unknown"))
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
                // A Label as the value of a Form LabeledContent laid out ~140 pt of blank space below the row (iOS 26).
                LabeledContent("Evidence") {
                    HStack(spacing: 6) {
                        Image(systemName: SpotPresentation.existenceSymbol(spot.verification.existenceTier))
                            .accessibilityHidden(true)
                        Text(SpotPresentation.evidence(spot))
                    }
                }
                if let confirmations = spot.verification.confirmations {
                    LabeledContent("Independent user confirmations", value: "\(confirmations)")
                }
                switch spot.verification.existenceTier {
                case .communityVerified:
                    Label("Confirmed by independent reports from users that MannerPath reviewed, not by an official listing. Check on-site signs.",
                          systemImage: "person.2")
                        .font(.footnote).foregroundStyle(.secondary)
                case .communityReported:
                    Label("Reported by one user and reviewed by MannerPath, but not yet confirmed by anyone else. Check on-site signs before you rely on it.",
                          systemImage: "person")
                        .font(.footnote).foregroundStyle(.secondary)
                case .unknown:
                    Label("This app version cannot tell how this place was confirmed. Check on-site signs.", systemImage: "questionmark.circle")
                        .font(.footnote).foregroundStyle(.secondary)
                case .official, .operator:
                    EmptyView()
                }
                if let note = SpotPresentation.approximateLocationNote(spot) ?? SpotPresentation.locationNote(spot.verification.locationPrecision) {
                    LabeledContent("Location", value: note)
                }
                LabeledContent("Last verified", value: SpotPresentation.verificationDate(spot.lastVerifiedAt))
                LabeledContent("Freshness", value: SpotPresentation.confirmation(result))
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
                    Button(hasSavedReport ? "Continue saved report" : "Report information about this place") { onReport(.exists) }
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
                    Text("Secure reporting isn't supported on this device.")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("Place details")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: previewKey) { await loadPreview() }
        .onDisappear { previewRouter.cancel() }
    }

    private var acceptsFindings: Bool {
        if case .available(let limits) = reportAvailability { return limits.acceptsExistingSpotFindings }
        return false
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

    private func detailText(_ label: LocalizedStringKey, _ value: String) -> some View {
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
