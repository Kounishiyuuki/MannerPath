import AppIntents
import SwiftUI
import WidgetKit

struct OpenWatchNearbyIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Open Watch Nearby"
    static let description = IntentDescription("Open saved nearby places on Watch.")
    static let openAppWhenRun = true
    func perform() async throws -> some IntentResult { .result() }
}

struct WatchNearbyEntry: TimelineEntry {
    let date: Date
    let snapshot: WatchSnapshot?
}

struct WatchNearbyProvider: AppIntentTimelineProvider {
    func recommendations() -> [AppIntentRecommendation<OpenWatchNearbyIntent>] {
        [AppIntentRecommendation(intent: OpenWatchNearbyIntent(), description: "Nearby")]
    }
    func placeholder(in context: Context) -> WatchNearbyEntry { WatchNearbyEntry(date: .now, snapshot: nil) }
    func snapshot(for configuration: OpenWatchNearbyIntent, in context: Context) async -> WatchNearbyEntry { entry() }
    func timeline(for configuration: OpenWatchNearbyIntent, in context: Context) async -> Timeline<WatchNearbyEntry> {
        let current = entry()
        let expiry = current.snapshot?.generatedAt.addingTimeInterval(3_601)
        let entries = if let expiry, expiry > current.date {
            [current, WatchNearbyEntry(date: expiry, snapshot: current.snapshot)]
        } else { [current] }
        return Timeline(entries: entries, policy: .after(Date().addingTimeInterval(3_600)))
    }
    private func entry() -> WatchNearbyEntry {
        WatchNearbyEntry(date: .now, snapshot: try? WatchStore.applicationSupport().snapshot())
    }
}

struct WatchNearbyWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "WatchNearby", intent: OpenWatchNearbyIntent.self,
                               provider: WatchNearbyProvider()) { entry in
            Button(intent: OpenWatchNearbyIntent()) {
                VStack(alignment: .leading) {
                    switch WatchWidgetState.evaluate(entry.snapshot, at: entry.date) {
                    case .unavailable:
                        Text("No saved data").font(.headline)
                        Text("Open iPhone app to sync")
                    case .stale:
                        if let spot = entry.snapshot?.spots.first {
                            if let name = spot.name { Text(name).font(.headline).lineLimit(1) }
                            else { Text("Saved place").font(.headline) }
                            if let note = ApproximateLocation.widgetNote(precision: spot.locationPrecision) {
                                Text(note).font(.caption2).lineLimit(1)
                            }
                        }
                        Text("Old data from iPhone")
                    case .empty:
                        Text("No saved nearby places").font(.headline)
                        Text("Open iPhone app to check nearby")
                    case .saved:
                        if let spot = entry.snapshot?.spots.first {
                            if let name = spot.name { Text(name).font(.headline).lineLimit(1) }
                            else { Text("Saved place").font(.headline) }
                            Text("From iPhone").font(.caption2)
                            Text(verification(spot.lastVerifiedAt, at: entry.date)).font(.caption2)
                            // ADR-0012/0017: only the place's own point goes unlabelled; nothing else may read as exact.
                            if let note = ApproximateLocation.widgetNote(precision: spot.locationPrecision) {
                                Text(note).font(.caption2).lineLimit(1)
                            }
                        }
                    }
                }
                .accessibilityElement(children: .combine)
            }
            .buttonStyle(.plain)
            .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Nearby")
        .description("Saved nearby places from iPhone.")
        .supportedFamilies([.accessoryRectangular])
    }

    private func verification(_ date: Date?, at now: Date) -> String {
        guard let date, now >= date else { return String(localized: "Verification date unknown") }
        let ageDays = now.timeIntervalSince(date) / 86_400
        guard ageDays.isFinite, ageDays < Double(Int.max) else { return String(localized: "Verification date unknown") }
        let days = Int(ageDays)
        if days == 0 { return String(localized: "Verified less than a day ago") }
        if days == 1 { return String(localized: "Verified 1 day ago") }
        return String(localized: "Verified \(days) days ago")
    }
}

@main struct WatchNearbyWidgets: WidgetBundle {
    var body: some Widget { WatchNearbyWidget() }
}
