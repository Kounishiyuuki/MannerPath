import Foundation

/// The public Privacy Policy / Support site (site/, published by GitHub Pages; docs/PUBLIC_SITE.md).
/// The origin is a release build setting (`MANNERPATH_PUBLIC_SITE_URL` → Info.plist `MannerPathPublicSiteURL`),
/// empty until the maintainer confirms the published URL, so no unpublished address ships. The contact address is
/// a confirmed maintainer input and is always available.
nonisolated enum PublicSite {
    static let operatorName = "MannerPath 運営"
    static let contactEmail = "mannerpath.support@gmail.com"
    static let contactURL = URL(string: "mailto:\(contactEmail)")!

    struct Links: Equatable {
        let privacyPolicy: URL
        let support: URL
    }

    static var links: Links? {
        links(from: Bundle.main.object(forInfoDictionaryKey: "MannerPathPublicSiteURL") as? String)
    }

    /// HTTPS only, with a host and no query, fragment or credentials; pages live at privacy/ and support/.
    static func links(from value: String?) -> Links? {
        guard let value, var components = URLComponents(string: value),
              components.scheme?.lowercased() == "https", components.host?.isEmpty == false,
              components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil else { return nil }
        if !components.path.hasSuffix("/") { components.path += "/" }
        guard let base = components.url,
              let privacy = URL(string: "privacy/", relativeTo: base)?.absoluteURL,
              let support = URL(string: "support/", relativeTo: base)?.absoluteURL else { return nil }
        return Links(privacyPolicy: privacy, support: support)
    }
}
