import AppIntents

struct OpenNearbyIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Open Nearby"
    static let description = IntentDescription("Open nearby places in MannerPath.")
    static let openAppWhenRun = true

    func perform() async throws -> some IntentResult { .result() }
}
