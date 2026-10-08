import Foundation

nonisolated struct NearbyGlance: Codable, Equatable, Sendable {
    static let version = 1
    let version: Int
    let computedAt: Date
    let locationObservedAt: Date
    let locationIsLastKnown: Bool
    let spotID: String?
    let name: String?
    let distanceMeters: Double?
    let lastVerifiedAt: Date?
    // ADR-0017: the nearest place's pin is an area anchor, so its distance is approximate. Optional so a glance
    // written by an older build decodes (and is shown exactly as before).
    var locationIsApproximate: Bool? = nil
    // ADR-0012 existence tier raw value of the nearest place. Optional so a glance written by an older build decodes;
    // absent or unrecognised reads as unknown, never as confirmed.
    var existence: String? = nil
    // ADR-0012 location precision raw value of the nearest place. Optional so a version 1 glance written before it
    // existed still decodes; no version bump because older readers ignore the extra key.
    var locationPrecision: String? = nil

    /// How far the widget may trust the pin. Only the publisher's or a user's own point is exact; never inferred from
    /// the evidence tier. Without the raw value (an older glance) only the old approximate flag is honoured and
    /// everything else is unknown, never exact.
    var precision: GlancePrecision {
        switch locationPrecision {
        case "publisherPoint", "communityPinned": .exact
        case "areaApproximate": .approximate
        case "reviewedDerived": .derived
        case nil: locationIsApproximate == true ? .approximate : .unknown
        default: .unknown
        }
    }

    /// ADR-0012 label for the widget, worded as in the app. Never above the evidence.
    var existenceLabel: String {
        switch existence {
        case "official": String(localized: "Officially confirmed")
        case "operator": String(localized: "Confirmed by the operator")
        case "communityVerified": String(localized: "Confirmed by users")
        case "communityReported": String(localized: "User report · unconfirmed")
        default: String(localized: "Confirmation status unknown")
        }
    }

    func validated() throws -> Self {
        guard version == Self.version, computedAt.timeIntervalSince1970.isFinite, locationObservedAt.timeIntervalSince1970.isFinite,
              lastVerifiedAt == nil || lastVerifiedAt!.timeIntervalSince1970.isFinite,
              (spotID == nil) == (name == nil && distanceMeters == nil && lastVerifiedAt == nil),
              spotID == nil || (!spotID!.isEmpty && name != nil && distanceMeters != nil &&
                                distanceMeters!.isFinite && distanceMeters! >= 0) else {
            throw GlanceError.invalid
        }
        return self
    }

    var deepLink: URL {
        var components = URLComponents()
        components.scheme = "mannerpath"
        components.host = "nearby"
        if let spotID { components.queryItems = [URLQueryItem(name: "spot", value: spotID)] }
        return components.url!
    }

    static func spotID(from url: URL) -> String?? {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme == "mannerpath", parts.host == "nearby", parts.path.isEmpty,
              parts.user == nil, parts.password == nil, parts.port == nil,
              parts.fragment == nil else { return nil }
        let items = parts.queryItems ?? []
        guard items.count <= 1 else { return nil }
        if items.isEmpty { return .some(nil) }
        guard items[0].name == "spot", let id = items[0].value, !id.isEmpty else { return nil }
        return .some(id)
    }

    func state(at now: Date) -> GlanceState {
        guard now >= computedAt, now.timeIntervalSince(computedAt) <= 3_600,
              now >= locationObservedAt, now.timeIntervalSince(locationObservedAt) <= 3_600,
              !locationIsLastKnown else { return .stale }
        return spotID == nil ? .empty : .fresh
    }
}

nonisolated enum GlancePrecision: Equatable { case exact, approximate, derived, unknown }
nonisolated enum GlanceState: Equatable { case fresh, stale, empty, unavailable }
nonisolated enum GlanceError: Error { case invalid }

nonisolated enum NearbyGlanceCodec {
    static func encode(_ value: NearbyGlance) throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970
        return try encoder.encode(value.validated())
    }
    static func decode(_ data: Data) throws -> NearbyGlance {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        return try decoder.decode(NearbyGlance.self, from: data).validated()
    }
}

nonisolated enum NearbyGlanceFile {
    static let group = "group.com.kounishiyuuki.MannerPath"
    static let filename = "nearby-glance-v1.json"

    static func read(from directory: URL?) -> NearbyGlance? {
        guard let directory, let data = try? Data(contentsOf: directory.appendingPathComponent(filename)) else { return nil }
        return try? NearbyGlanceCodec.decode(data)
    }
    static func write(_ value: NearbyGlance, to directory: URL?) throws {
        guard let directory else { throw GlanceError.invalid }
        try NearbyGlanceCodec.encode(value).write(to: directory.appendingPathComponent(filename), options: .atomic)
    }
}
