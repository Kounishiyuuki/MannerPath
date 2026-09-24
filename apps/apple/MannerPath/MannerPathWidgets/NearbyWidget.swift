import AppIntents
import SwiftUI
import WidgetKit

struct NearbyProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> NearbyEntry { NearbyEntry(date: .now, glance: nil) }
    func snapshot(for configuration: OpenNearbyIntent, in context: Context) async -> NearbyEntry { entry() }
    func timeline(for configuration: OpenNearbyIntent, in context: Context) async -> Timeline<NearbyEntry> {
        let current = entry()
        let expiry = current.glance.map { min($0.computedAt, $0.locationObservedAt).addingTimeInterval(3_601) }
        let entries = if let expiry, expiry > current.date {
            [current, NearbyEntry(date: expiry, glance: current.glance)]
        } else { [current] }
        return Timeline(entries: entries, policy: .after(Date().addingTimeInterval(3_600)))
    }
    private func entry() -> NearbyEntry {
        let directory = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: NearbyGlanceFile.group)
        return NearbyEntry(date: .now, glance: NearbyGlanceFile.read(from: directory))
    }
}

struct NearbyEntry: TimelineEntry {
    let date: Date
    let glance: NearbyGlance?
}

struct NearbyWidget: Widget {
    let kind = "NearbyGlance"
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: kind, intent: OpenNearbyIntent.self, provider: NearbyProvider()) { entry in
            NearbyWidgetView(entry: entry)
        }
        .configurationDisplayName("Nearby")
        .description("Saved nearby place and its freshness.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}

struct NearbyWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: NearbyEntry
    var body: some View {
        let state = entry.glance?.state(at: entry.date) ?? .unavailable
        let compact = family == .accessoryRectangular
        VStack(alignment: .leading, spacing: compact ? 1 : 4) {
            switch state {
            case .fresh:
                if let glance = entry.glance {
                    if let name = glance.name {
                        Text(name).font(compact ? .caption : .headline).lineLimit(compact ? 1 : 2)
                    } else { Text("Nearby place").font(compact ? .caption : .headline) }
                    if let distance = glance.distanceMeters {
                        if distance < 1_000 {
                            Text("\(Int(distance.rounded())) m away")
                        } else {
                            Text("\((distance / 1_000).formatted(.number.precision(.fractionLength(1)))) km away")
                        }
                    }
                    Text(verification(glance.lastVerifiedAt, now: entry.date))
                        .font(.caption2).foregroundStyle(.secondary)
                }
            case .stale:
                if let name = entry.glance?.name {
                    Text(name).font(compact ? .caption : .headline).lineLimit(compact ? 1 : 2)
                } else { Text("Saved nearby data is old").font(compact ? .caption : .headline) }
                if compact {
                    Text("Old data · Open app").font(.caption2).foregroundStyle(.secondary)
                } else {
                    Text("Nearby data is old · Open app to refresh")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            case .empty:
                Text("No saved nearby places").font(compact ? .caption : .headline)
                if compact { Text("Open app").font(.caption2).foregroundStyle(.secondary) }
                else { Text("Open app to check nearby").font(.caption2).foregroundStyle(.secondary) }
            case .unavailable:
                Text("Nearby data unavailable").font(compact ? .caption : .headline)
                if compact { Text("Open app").font(.caption2).foregroundStyle(.secondary) }
                else { Text("Open app to check nearby").font(.caption2).foregroundStyle(.secondary) }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .containerBackground(.fill.tertiary, for: .widget)
        .widgetURL(state == .fresh ? entry.glance?.deepLink : URL(string: "mannerpath://nearby"))
    }

    private func verification(_ date: Date?, now: Date) -> String {
        guard let date, now >= date else { return String(localized: "Verification date unknown") }
        let ageDays = now.timeIntervalSince(date) / 86_400
        guard ageDays.isFinite, ageDays < Double(Int.max) else { return String(localized: "Verification date unknown") }
        let days = Int(ageDays)
        return days == 0 ? String(localized: "Verified today") : String(localized: "Verified \(days) days ago")
    }
}

@main struct NearbyWidgets: WidgetBundle {
    var body: some Widget { NearbyWidget() }
}
