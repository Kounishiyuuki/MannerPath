import Foundation

// These values are resolved spot data, not source records or map search results.
struct Spot: Codable, Sendable, Identifiable {
    let id: String
    let mergedInto: String?
    let name: String?
    let latitude: Double
    let longitude: Double
    let tileId: String
    let spotType: SpotType
    let hostType: HostType?
    let accessType: AccessType
    let environment: SpotEnvironment
    let supportsPaper: TriState
    let supportsHeated: TriState
    let openingHours: SpotOpeningHours?
    let feeType: FeeType?
    let floor: String?
    let entranceNote: String?
    let lifecycle: SpotLifecycle
    let verification: SpotVerification
    let lastVerifiedAt: Date?
    let createdAt: Date
    let updatedAt: Date
}

// Unsupported future wire values decode conservatively so one new server value cannot discard a tile.
enum TriState: String, Codable, Sendable {
    case yes, no, unknown

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: value) ?? .unknown
    }
}

// "unknown" is a supported physical type; only a future unsupported value is excluded from Nearby.
enum SpotType: String, Codable, Hashable, Sendable {
    case designatedOutdoorArea, publicSmokingRoom, facilitySmokingRoom
    case ashtray, smokingPermittedVenue, unknown, unsupported

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: value) ?? .unsupported
    }
}

enum HostType: String, Codable, Sendable {
    case municipality, station, commercialBuilding, convenienceStore
    case restaurantOrCafe, other, unknown

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: value) ?? .unknown
    }
}

enum AccessType: String, Codable, Sendable {
    case `public`, customerOnly, facilityOnly, unknown

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: value) ?? .unknown
    }
}

enum SpotEnvironment: String, Codable, Sendable {
    case indoor, outdoor, covered, unknown

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: value) ?? .unknown
    }
}

enum SpotLifecycle: String, Codable, Sendable {
    case active, temporarilyClosed, removed, unknown

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: value) ?? .unknown
    }
}

// The normalized hours format and fee vocabulary are not yet an API contract.
// Keep their supplied values without trying to infer whether a spot is open or free.
struct SpotOpeningHours: Codable, Sendable {
    let raw: String?
    let parsed: String?
    let parseStatus: String
    let timeZone: String
}

struct FeeType: Codable, Hashable, Sendable {
    let rawValue: String

    init(from decoder: Decoder) throws {
        rawValue = try decoder.singleValueContainer().decode(String.self)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}
