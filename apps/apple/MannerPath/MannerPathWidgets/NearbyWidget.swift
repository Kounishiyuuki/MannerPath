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
                        // ADR-0012/0017: only an exact point gets an exact-looking distance; every other pin says
                        // 「約」 and why, in every family.
                        if glance.precision == .exact {
                            Text(distanceText(distance))
                        } else if compact {
                            // One line on the Lock Screen, so the note is the short form and must never be cut off.
                            Text(verbatim: "\(String(localized: "About \(distanceText(distance))")) · \(shortPrecisionNote(glance.precision))")
                                .lineLimit(1).minimumScaleFactor(0.7)
                        } else {
                            Text("About \(distanceText(distance))")
                            Text(precisionNote(glance.precision)).font(.caption2).lineLimit(2)
                        }
                    }
                    Text(glance.existenceLabel).font(.caption2).lineLimit(1)
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
            // Neither state says no smoking place exists: one is an empty saved result, the other has no saved data.
            case .empty:
                Text("No saved nearby places").font(compact ? .caption : .headline)
                if compact { Text("Open app").font(.caption2).foregroundStyle(.secondary) }
                else { Text("Open app to check nearby").font(.caption2).foregroundStyle(.secondary) }
            case .unavailable:
                Text("No saved data").font(compact ? .caption : .headline)
                if compact { Text("Open app").font(.caption2).foregroundStyle(.secondary) }
                else { Text("Open app to check nearby").font(.caption2).foregroundStyle(.secondary) }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .containerBackground(.fill.tertiary, for: .widget)
        .widgetURL(state == .fresh ? entry.glance?.deepLink : URL(string: "mannerpath://nearby"))
    }

    private func distanceText(_ meters: Double) -> String {
        meters < 1_000 ? String(localized: "\(Int(meters.rounded())) m away") :
            String(localized: "\((meters / 1_000).formatted(.number.precision(.fractionLength(1)))) km away")
    }

    private func precisionNote(_ precision: GlancePrecision) -> String {
        switch precision {
        case .approximate: String(localized: "Approximate location")
        case .derived: String(localized: "Estimated from the address")
        case .exact, .unknown: String(localized: "Location precision unknown")
        }
    }

    private func shortPrecisionNote(_ precision: GlancePrecision) -> String {
        switch precision {
        case .approximate: String(localized: "Approx. location")
        case .derived: String(localized: "Estimated")
        case .exact, .unknown: String(localized: "Precision unknown")
        }
    }

    private func verification(_ date: Date?, now: Date) -> String {
        guard let date, now >= date else { return String(localized: "Verification date unknown") }
        let ageDays = now.timeIntervalSince(date) / 86_400
        guard ageDays.isFinite, ageDays < Double(Int.max) else { return String(localized: "Verification date unknown") }
        let days = Int(ageDays)
        if days == 0 { return String(localized: "Verified today") }
        if days == 1 { return String(localized: "Verified 1 day ago") }
        return String(localized: "Verified \(days) days ago")
    }
}

@main struct NearbyWidgets: WidgetBundle {
    var body: some Widget { NearbyWidget() }
}
