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

    func validated() throws -> Self {
        guard version == Self.version, computedAt.timeIntervalSince1970.isFinite, locationObservedAt.timeIntervalSince1970.isFinite,
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
              parts.scheme == "mannerpath", parts.host == "nearby", parts.path.isEmpty else { return nil }
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
