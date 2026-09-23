import Foundation

nonisolated enum WatchNavigation {
    // Unified Maps URLs are supported on watchOS 11.4 and later.
    static func walkingURL(for spot: WatchSpot) -> URL? {
        var components = URLComponents(string: "https://maps.apple.com/directions")
        components?.queryItems = [
            URLQueryItem(name: "destination", value: "\(spot.latitude),\(spot.longitude)"),
            URLQueryItem(name: "mode", value: "walking")
        ]
        return components?.url
    }

    static func fallback(hasLocation: Bool) -> String {
        hasLocation ? String(localized: "If Maps cannot route, use straight-line distance and bearing above.") :
            String(localized: "Watch location is needed for straight-line distance and bearing.")
    }
}
