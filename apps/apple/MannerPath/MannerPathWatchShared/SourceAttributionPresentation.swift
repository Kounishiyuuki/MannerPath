import Foundation

nonisolated enum SourceAttributionPresentation {
    static var modificationNotice: String {
        String(localized: "MannerPath extracts and normalizes smoking-place data from the original sources. Some access conditions and opening hours may be treated conservatively; unknown conditions are not confirmation.")
    }

    static func licenseURL(_ rawURL: String?) -> URL? {
        guard let rawURL, !rawURL.isEmpty,
              rawURL.rangeOfCharacter(from: .whitespacesAndNewlines.union(.controlCharacters)) == nil,
              let components = URLComponents(string: rawURL),
              let scheme = components.scheme?.lowercased(), ["http", "https"].contains(scheme),
              let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil else { return nil }
        return components.url
    }
}
