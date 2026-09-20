import Foundation

// These values are resolved spot data, not source records or map search results.
nonisolated struct Spot: Codable, Sendable, Identifiable {
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
    // Tile v1 does not supply these timestamps. An absent value is not the fetch time.
    let createdAt: Date?
    let updatedAt: Date?
}

// Unsupported future wire values decode conservatively so one new server value cannot discard a tile.
nonisolated enum TriState: String, Codable, Sendable {
    case yes, no, unknown

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: value) ?? .unknown
    }
}

// "unknown" is a supported physical type; only a future unsupported value is excluded from Nearby.
nonisolated enum SpotType: String, Codable, Hashable, Sendable {
    case designatedOutdoorArea, publicSmokingRoom, facilitySmokingRoom
    case ashtray, smokingPermittedVenue, unknown, unsupported

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: value) ?? .unsupported
    }
}

nonisolated enum HostType: String, Codable, Sendable {
    case municipality, station, commercialBuilding, convenienceStore
    case restaurantOrCafe, other, unknown

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: value) ?? .unknown
    }
}

nonisolated enum AccessType: String, Codable, Hashable, Sendable {
    case `public`, customerOnly, facilityOnly, unknown

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: value) ?? .unknown
    }
}

nonisolated enum SpotEnvironment: String, Codable, Hashable, Sendable {
    case indoor, outdoor, covered, unknown

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: value) ?? .unknown
    }
}

nonisolated enum SpotLifecycle: String, Codable, Sendable {
    case active, temporarilyClosed, removed, unknown

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: value) ?? .unknown
    }
}

nonisolated struct SpotOpeningHours: Codable, Sendable {
    let raw: String?
    let parsed: SpotParsedOpeningHours?
    let status: Status
    let timeZone: String

    nonisolated enum Status: String, Codable, Sendable {
        case none, parsed, unparsed, unsupported

        init(from decoder: Decoder) throws {
            let value = try decoder.singleValueContainer().decode(String.self)
            self = Self(rawValue: value) ?? .unsupported
        }
    }
}

nonisolated struct SpotParsedOpeningHours: Codable, Sendable {
    let version: Int
    let kind: Kind
    let opens: String?
    let closes: String?

    nonisolated enum Kind: String, Codable, Sendable {
        case allDay, daily, unsupported

        init(from decoder: Decoder) throws {
            let value = try decoder.singleValueContainer().decode(String.self)
            self = Self(rawValue: value) ?? .unsupported
        }
    }
}

nonisolated struct FeeType: Codable, Hashable, Sendable {
    let rawValue: String

    init(from decoder: Decoder) throws {
        rawValue = try decoder.singleValueContainer().decode(String.self)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}
