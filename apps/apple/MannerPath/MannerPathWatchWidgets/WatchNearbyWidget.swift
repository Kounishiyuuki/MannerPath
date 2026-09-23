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
                        Text("Saved data is old")
                    case .empty:
                        Text("No saved places")
                    case .saved:
                        if let spot = entry.snapshot?.spots.first {
                            Text(spot.name ?? "Saved place").lineLimit(1)
                            Text("From iPhone").font(.caption2)
                            if let verified = spot.lastVerifiedAt, entry.date >= verified {
                                Text("Verified \(Int(entry.date.timeIntervalSince(verified) / 86_400)) days ago")
                                    .font(.caption2)
                            } else {
                                Text("Verification date unknown").font(.caption2)
                            }
                        }
                    }
                }
            }
            .buttonStyle(.plain)
            .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Nearby")
        .description("Saved nearby places from iPhone.")
        .supportedFamilies([.accessoryRectangular, .accessoryCircular])
    }
}

@main struct WatchNearbyWidgets: WidgetBundle {
    var body: some Widget { WatchNearbyWidget() }
}
