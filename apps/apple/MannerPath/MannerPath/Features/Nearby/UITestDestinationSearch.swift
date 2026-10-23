#if DEBUG
import Foundation

/// Synthetic, in-memory destination UI fixtures. They exercise the real model/debounce/ranker/view, not MapKit.
/// No backend, saved-place corpus, persistence or walking-route service is attached. Never compiled into Release.
@MainActor
enum UITestDestinationSearch {
    static func makeModel(scenario: String) -> NearbyModel? {
        guard ["progressive", "single", "empty", "failure", "fallback"].contains(scenario) else { return nil }
        let provider = Provider(scenario: scenario)
        return NearbyModel(location: DeviceLocationService(), repository: nil, refresher: nil,
                           destinationSearch: provider, destinationCompleter: provider)
    }

    private struct Provider: DestinationSearching, DestinationCompleting {
        let scenario: String

        func search(_ text: String, near origin: SpotCoordinate?) async throws -> [PlaceDestination] {
            if scenario == "failure" { throw URLError(.notConnectedToInternet) }
            if scenario == "fallback" {
                return [PlaceDestination(id: UUID(), name: "\(text)駅", subtitle: "UIテスト用の目的地",
                                         coordinate: SpotCoordinate(latitude: 35.714, longitude: 139.777))]
            }
            return []
        }

        func suggestions(for text: String, near origin: SpotCoordinate?) async throws -> [DestinationSuggestion] {
            try await suggestions(for: text, near: origin, onUpdate: { _ in })
        }

        func suggestions(for text: String, near origin: SpotCoordinate?,
                         onUpdate: @escaping @MainActor ([DestinationSuggestion]) -> Void) async throws -> [DestinationSuggestion] {
            try await Task.sleep(for: .milliseconds(150))
            if scenario == "failure" { throw URLError(.notConnectedToInternet) }
            if scenario == "empty" || scenario == "fallback" { return [] }
            let query = text.trimmingCharacters(in: .whitespacesAndNewlines)
            let station = DestinationSuggestion(id: "station-\(query)", title: "\(query)駅", subtitle: "UIテスト用の目的地")
            if scenario == "single" { return [station] }
            // A real completer can publish an area first and supplement it later. Do not assert the interim count.
            onUpdate([DestinationSuggestion(id: "area-\(query)", title: query, subtitle: "UIテスト用の地域")])
            try await Task.sleep(for: .milliseconds(600))
            return [station, DestinationSuggestion(id: "park-\(query)", title: "\(query)恩賜公園", subtitle: "UIテスト用の目的地"),
                    DestinationSuggestion(id: "other-\(query)", title: "京成\(query)駅", subtitle: "UIテスト用の目的地")]
        }

        func resolve(_ suggestion: DestinationSuggestion, near origin: SpotCoordinate?) async throws -> PlaceDestination {
            try await Task.sleep(for: .milliseconds(150))
            return PlaceDestination(id: UUID(), name: suggestion.title, subtitle: suggestion.subtitle,
                                    coordinate: SpotCoordinate(latitude: 35.714, longitude: 139.777))
        }
    }
}
#endif
