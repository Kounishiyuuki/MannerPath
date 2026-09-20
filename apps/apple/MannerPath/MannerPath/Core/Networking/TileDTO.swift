import Foundation

// Wire schema from services/api/src/tiles/dto.ts. Strings stay unclosed here so a later
// enum case cannot make an otherwise usable tile fail to decode.
nonisolated struct TileBodyV1: Decodable, Sendable {
    let schemaVersion: Int
    let tile: String
    let revision: Int
    let generatedAt: String
    let spots: [TileSpotV1]
    let sources: [TileSourceV1]
}

nonisolated struct TileSpotV1: Decodable, Sendable {
    let id: String
    let name: String?
    let latitude: Double
    let longitude: Double
    let spotType: String
    let accessType: String
    let environment: String
    let supportsPaper: String
    let supportsHeated: String
    let openingHours: TileOpeningHoursV1
    let lifecycle: String
    let evidenceQuality: String
    let evidenceQualityVersion: String
    let lastVerifiedAt: String?
    let sourceIds: [String]

    private enum CodingKeys: String, CodingKey {
        case id, name, latitude, longitude, spotType, accessType, environment
        case supportsPaper, supportsHeated, openingHours, lifecycle, evidenceQuality
        case evidenceQualityVersion, lastVerifiedAt, sourceIds
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String?.self, forKey: .name)
        latitude = try c.decode(Double.self, forKey: .latitude)
        longitude = try c.decode(Double.self, forKey: .longitude)
        spotType = try c.decode(String.self, forKey: .spotType)
        accessType = try c.decode(String.self, forKey: .accessType)
        environment = try c.decode(String.self, forKey: .environment)
        supportsPaper = try c.decode(String.self, forKey: .supportsPaper)
        supportsHeated = try c.decode(String.self, forKey: .supportsHeated)
        openingHours = try c.decode(TileOpeningHoursV1.self, forKey: .openingHours)
        lifecycle = try c.decode(String.self, forKey: .lifecycle)
        evidenceQuality = try c.decode(String.self, forKey: .evidenceQuality)
        evidenceQualityVersion = try c.decode(String.self, forKey: .evidenceQualityVersion)
        lastVerifiedAt = try c.decode(String?.self, forKey: .lastVerifiedAt)
        sourceIds = try c.decode([String].self, forKey: .sourceIds)
    }
}

nonisolated struct TileOpeningHoursV1: Decodable, Sendable {
    let status: String
    let raw: String?
    let parsed: Parsed?
    let timeZone: String

    nonisolated struct Parsed: Decodable, Sendable {
        let v: Int
        let kind: String
        let opens: String?
        let closes: String?
    }

    private enum CodingKeys: String, CodingKey { case status, raw, parsed, timeZone }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        status = try c.decode(String.self, forKey: .status)
        raw = try c.decode(String?.self, forKey: .raw)
        parsed = try c.decode(Parsed?.self, forKey: .parsed)
        timeZone = try c.decode(String.self, forKey: .timeZone)
    }
}

nonisolated struct TileSourceV1: Decodable, Sendable {
    let id: String
    let displayName: String
    let licenseName: String?
    let licenseUrl: String?
    let attributionText: String?

    private enum CodingKeys: String, CodingKey {
        case id, displayName, licenseName, licenseUrl, attributionText
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        displayName = try c.decode(String.self, forKey: .displayName)
        licenseName = try c.decode(String?.self, forKey: .licenseName)
        licenseUrl = try c.decode(String?.self, forKey: .licenseUrl)
        attributionText = try c.decode(String?.self, forKey: .attributionText)
    }
}
