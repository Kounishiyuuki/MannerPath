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
                    Text("Nearby").font(.headline)
                    switch WatchWidgetState.evaluate(entry.snapshot, at: entry.date) {
                    case .unavailable:
                        Text("Open iPhone app to sync")
                    case .stale:
                        if let spot = entry.snapshot?.spots.first {
                            if let name = spot.name { Text(name).lineLimit(1) }
                            else { Text("Saved place") }
                        }
                        Text("Saved data is old")
                    case .empty:
                        Text("No saved places")
                    case .saved:
                        if let spot = entry.snapshot?.spots.first {
                            if let name = spot.name { Text(name).lineLimit(1) }
                            else { Text("Saved place") }
                            Text("From iPhone").font(.caption2)
                            Text(verification(spot.lastVerifiedAt, at: entry.date)).font(.caption2)
                        }
                    }
                }
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
        return String(localized: "Verified \(Int(ageDays)) days ago")
    }
}

@main struct WatchNearbyWidgets: WidgetBundle {
    var body: some Widget { WatchNearbyWidget() }
}
