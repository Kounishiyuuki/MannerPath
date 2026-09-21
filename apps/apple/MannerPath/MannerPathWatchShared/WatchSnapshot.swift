import Foundation

// Wire and disk contract shared by the iPhone producer and Watch consumer. Values stay
// as strings so a later enum case never acquires an accidental confirmed meaning.
nonisolated struct WatchSnapshot: Codable, Sendable, Equatable {
    static let schemaVersion = 1
    let schemaVersion: Int
    let revision: UInt64
    let generatedAt: Date
    let snapshotID: UUID
    let spots: [WatchSpot]
    let sources: [WatchSource]

    func validated() throws -> Self {
        guard schemaVersion == Self.schemaVersion, revision > 0,
              generatedAt.timeIntervalSince1970.isFinite,
              spots.count <= 500 else { throw WatchPayloadError.invalid }
        var ids = Set<String>()
        let sourceIDs = Set(sources.map(\.id))
        guard sources.allSatisfy({ !$0.id.isEmpty }),
              Set(sources).count == sources.count else { throw WatchPayloadError.invalid }
        for spot in spots {
            guard !spot.id.isEmpty, ids.insert(spot.id).inserted,
                  spot.latitude.isFinite, (-90...90).contains(spot.latitude),
                  spot.longitude.isFinite, (-180...180).contains(spot.longitude),
                  spot.sourceIDs.allSatisfy({ !$0.isEmpty && sourceIDs.contains($0) }),
                  Set(spot.sourceIDs).count == spot.sourceIDs.count else { throw WatchPayloadError.invalid }
        }
        return self
    }

    func sources(for spot: WatchSpot) -> [WatchSource] {
        sources.filter { spot.sourceIDs.contains($0.id) }
    }
}

nonisolated struct WatchSpot: Codable, Sendable, Equatable {
    let id: String
    let name: String?
    let latitude: Double
    let longitude: Double
    let spotType: String
    let accessType: String
    let supportsPaper: String
    let supportsHeated: String
    let lifecycle: String
    let evidenceQuality: String?
    let evidenceQualityVersion: String?
    let lastVerifiedAt: Date?
    let openingHours: WatchHours?
    let sourceIDs: [String]
}

nonisolated struct WatchHours: Codable, Sendable, Equatable {
    let status: String
    let kind: String?
    let version: Int?
    let opens: String?
    let closes: String?
    let timeZone: String
}

nonisolated struct WatchSource: Codable, Sendable, Hashable {
    let id: String
    let displayName: String
    let licenseName: String?
    let licenseURL: String?
    let attributionText: String?
}

nonisolated struct WatchPreferences: Codable, Sendable, Equatable {
    static let schemaVersion = 1
    let schemaVersion: Int
    let generatedAt: Date
    let tobaccoType: String? // paper | heated | nil
    let requireConfirmedTobaccoSupport: Bool
    let publicAccessOnly: Bool
    let requireConfirmedPublicAccess: Bool
    let spotTypes: [String]?
    let openNowOnly: Bool
    let officialEvidenceOnly: Bool
    let verifiedWithinDays: Int?

    static func defaults(at date: Date = .distantPast) -> Self {
        Self(schemaVersion: 1, generatedAt: date, tobaccoType: nil,
             requireConfirmedTobaccoSupport: false, publicAccessOnly: false,
             requireConfirmedPublicAccess: false, spotTypes: nil, openNowOnly: false,
             officialEvidenceOnly: false, verifiedWithinDays: nil)
    }

    func validated() throws -> Self {
        guard schemaVersion == Self.schemaVersion,
              generatedAt.timeIntervalSince1970.isFinite,
              tobaccoType == nil || tobaccoType == "paper" || tobaccoType == "heated",
              verifiedWithinDays == nil || (1...3650).contains(verifiedWithinDays!),
              spotTypes == nil || spotTypes!.count <= 20 else { throw WatchPayloadError.invalid }
        return self
    }
}

nonisolated enum WatchPayloadError: Error { case invalid }

nonisolated enum WatchCodec {
    static func encode<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970
        return try encoder.encode(value)
    }

    static func snapshot(_ data: Data) throws -> WatchSnapshot {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        return try decoder.decode(WatchSnapshot.self, from: data).validated()
    }

    static func preferences(_ data: Data) throws -> WatchPreferences {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        return try decoder.decode(WatchPreferences.self, from: data).validated()
    }
}

nonisolated struct WatchRankedSpot: Sendable {
    let spot: WatchSpot
    let distanceMeters: Double
    let bearingDegrees: Double
    let verificationAgeDays: Int?
}

nonisolated enum WatchRanking {
    static func topThree(_ snapshot: WatchSnapshot, latitude: Double?, longitude: Double?,
                         preferences: WatchPreferences, at now: Date) -> [WatchRankedSpot] {
        if let latitude, let longitude,
           (!latitude.isFinite || !longitude.isFinite || !(-90...90).contains(latitude) ||
            !(-180...180).contains(longitude)) { return [] }
        let results = snapshot.spots.compactMap { spot -> WatchRankedSpot? in
            guard spot.lifecycle == "active", spot.spotType != "unsupported",
                  Self.knownTypes.contains(spot.spotType),
                  preferences.spotTypes == nil || preferences.spotTypes!.contains(spot.spotType) else { return nil }
            if let tobacco = preferences.tobaccoType {
                let support = tobacco == "paper" ? spot.supportsPaper : spot.supportsHeated
                if support == "no" || (preferences.requireConfirmedTobaccoSupport && support != "yes") {
                    return nil
                }
            }
            if preferences.publicAccessOnly && ["customerOnly", "facilityOnly"].contains(spot.accessType) {
                return nil
            }
            if preferences.requireConfirmedPublicAccess && spot.accessType != "public" { return nil }
            if preferences.officialEvidenceOnly &&
                (spot.evidenceQualityVersion != "evidence-quality.v1" || spot.evidenceQuality != "officialListing") {
                return nil
            }
            if preferences.openNowOnly && openNow(spot.openingHours, at: now) != "yes" { return nil }
            let ageSeconds = spot.lastVerifiedAt.flatMap { date -> TimeInterval? in
                let seconds = now.timeIntervalSince(date)
                return seconds >= 0 ? seconds : nil
            }
            if let days = preferences.verifiedWithinDays,
               ageSeconds == nil || ageSeconds! > Double(days) * 86_400 { return nil }
            let distance = if let latitude, let longitude {
                distance(latitude, longitude, spot.latitude, spot.longitude)
            } else { Double.nan }
            let direction = if let latitude, let longitude {
                bearing(latitude, longitude, spot.latitude, spot.longitude)
            } else { Double.nan }
            return WatchRankedSpot(spot: spot, distanceMeters: distance,
                                   bearingDegrees: direction,
                                   verificationAgeDays: ageSeconds.map { Int($0 / 86_400) })
        }
        guard latitude != nil, longitude != nil else { return Array(results.prefix(3)) }
        return results.sorted {
            $0.distanceMeters == $1.distanceMeters ? $0.spot.id < $1.spot.id :
                $0.distanceMeters < $1.distanceMeters
        }.prefix(3).map { $0 }
    }

    private static let knownTypes: Set<String> = ["designatedOutdoorArea", "publicSmokingRoom",
                                                   "facilitySmokingRoom", "ashtray",
                                                   "smokingPermittedVenue", "unknown"]

    private static func distance(_ a: Double, _ b: Double, _ c: Double, _ d: Double) -> Double {
        let lat = (c - a) * .pi / 180, lon = (d - b) * .pi / 180
        let h = pow(sin(lat / 2), 2) + cos(a * .pi / 180) * cos(c * .pi / 180) * pow(sin(lon / 2), 2)
        return 12_742_000 * asin(min(1, sqrt(h)))
    }

    private static func bearing(_ a: Double, _ b: Double, _ c: Double, _ d: Double) -> Double {
        let start = a * .pi / 180, end = c * .pi / 180, delta = (d - b) * .pi / 180
        let y = sin(delta) * cos(end)
        let x = cos(start) * sin(end) - sin(start) * cos(end) * cos(delta)
        return (atan2(y, x) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
    }

    private static func openNow(_ hours: WatchHours?, at now: Date) -> String {
        guard let hours, hours.status == "parsed", hours.version == 1,
              let zone = TimeZone(identifier: hours.timeZone) else { return "unknown" }
        if hours.kind == "allDay" { return "yes" }
        guard hours.kind == "daily", let opens = minute(hours.opens), let closes = minute(hours.closes),
              opens < 1_440, opens != closes else { return "unknown" }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let parts = calendar.dateComponents([.hour, .minute], from: now)
        guard let hour = parts.hour, let minute = parts.minute else { return "unknown" }
        let current = hour * 60 + minute
        return (opens < closes ? (opens <= current && current < closes) :
                (current >= opens || current < closes)) ? "yes" : "no"
    }

    private static func minute(_ text: String?) -> Int? {
        guard let text else { return nil }
        let values = text.split(separator: ":", omittingEmptySubsequences: false)
        guard values.count == 2, values[0].count == 2, values[1].count == 2,
              let hour = Int(values[0]), let minute = Int(values[1]),
              (0...24).contains(hour), (0...59).contains(minute),
              hour != 24 || minute == 0 else { return nil }
        return hour * 60 + minute
    }
}
