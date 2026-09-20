import SwiftUI

struct SpotDetailView: View {
    let result: NearbyResult
    let locationAccuracyMeters: Double
    let estimateFromPreviousLocation: Bool
    let nearbySources: [SpotSource]

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
                detailText("Raw source text", spot.openingHours?.raw ?? "Unknown")
                if let hours = spot.openingHours, hours.status == .parsed,
                   let parsed = hours.parsed {
                    LabeledContent("Reported schedule", value: schedule(parsed))
                    LabeledContent("Time zone", value: hours.timeZone)
                }
            } header: {
                Text("Opening hours")
            } footer: {
                Text("Current open or closed status is unconfirmed.")
            }

            Section("Evidence and freshness") {
                LabeledContent("Evidence quality", value: SpotPresentation.evidence(spot.verification.evidenceQuality))
                LabeledContent("Last verified", value: SpotPresentation.verificationDate(spot.lastVerifiedAt))
                LabeledContent("Freshness", value: SpotPresentation.freshness(result))
                detailText("Sources", SpotPresentation.sourceNames(spot))
                NavigationLink(spot.verification.sources == nil
                               ? "All nearby cached source attributions"
                               : "Source and legal attribution") {
                    NearbyAttributionView(sources: spot.verification.sources ?? nearbySources)
                }
            }
        }
        .navigationTitle("Place details")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func schedule(_ parsed: SpotParsedOpeningHours) -> String {
        switch parsed.kind {
        case .allDay: "Reported all day"
        case .daily:
            if let opens = parsed.opens, let closes = parsed.closes {
                "Daily \(opens)–\(closes)"
            } else {
                "Daily schedule incomplete"
            }
        case .unsupported: "Unsupported schedule"
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
