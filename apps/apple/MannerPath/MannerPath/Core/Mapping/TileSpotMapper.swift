import Foundation

nonisolated struct MappedTile: Sendable {
    let tileID: String
    let revision: Int
    let generatedAt: Date
    let sources: [SpotSource]
    let spots: [Spot]
}

nonisolated enum TileSpotMapper {
    static func map(_ body: TileBodyV1, requestedTile: SlippyTile) throws -> MappedTile {
        guard body.schemaVersion == 1 else {
            throw TileSyncError.unsupportedSchemaVersion(body.schemaVersion)
        }
        guard requestedTile.z == SlippyTile.dataZoom,
              body.tile == requestedTile.id,
              body.revision >= 1,
              let generatedAt = timestamp(body.generatedAt) else {
            throw TileSyncError.malformedResponse
        }

        let sources = body.sources.map {
            SpotSource(id: $0.id, displayName: $0.displayName, licenseName: $0.licenseName,
                       licenseURL: $0.licenseUrl, attributionText: $0.attributionText)
        }
        let sourceByID = Dictionary(sources.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        guard sources.allSatisfy({ !$0.id.isEmpty && !$0.displayName.isEmpty }),
              sourceByID.count == sources.count else {
            throw TileSyncError.malformedResponse
        }

        let spots = try body.spots.map { wire -> Spot in
            guard validSpotID(wire.id),
                  SpotCoordinate(latitude: wire.latitude, longitude: wire.longitude).isValid,
                  (try? SlippyTile.forCoordinate(latitude: wire.latitude,
                                                longitude: wire.longitude,
                                                zoom: SlippyTile.dataZoom)) == requestedTile,
                  !wire.sourceIds.isEmpty,
                  Set(wire.sourceIds).count == wire.sourceIds.count,
                  wire.sourceIds.allSatisfy({ sourceByID[$0] != nil }) else {
                throw TileSyncError.malformedResponse
            }
            let hours = try mapHours(wire.openingHours)
            let observationDate: Date?
            if let day = wire.lastVerifiedAt {
                guard let parsed = observationDay(day) else { throw TileSyncError.malformedResponse }
                observationDate = parsed
            } else {
                observationDate = nil
            }
            let attributedSources = wire.sourceIds.compactMap { sourceByID[$0] }
            return Spot(
                id: wire.id,
                mergedInto: nil,
                name: wire.name,
                latitude: wire.latitude,
                longitude: wire.longitude,
                tileId: body.tile,
                spotType: SpotType(rawValue: wire.spotType) ?? .unsupported,
                hostType: nil,
                accessType: AccessType(rawValue: wire.accessType) ?? .unknown,
                environment: SpotEnvironment(rawValue: wire.environment) ?? .unknown,
                supportsPaper: TriState(rawValue: wire.supportsPaper) ?? .unknown,
                supportsHeated: TriState(rawValue: wire.supportsHeated) ?? .unknown,
                openingHours: hours,
                feeType: nil,
                floor: nil,
                entranceNote: nil,
                lifecycle: SpotLifecycle(rawValue: wire.lifecycle) ?? .unknown,
                verification: SpotVerification(
                    acceptedExistenceEvidence: .yes,
                    evidenceQuality: wire.evidenceQuality,
                    sourceDisplayNames: attributedSources.map(\.displayName),
                    evidenceQualityVersion: wire.evidenceQualityVersion,
                    sources: attributedSources
                ),
                lastVerifiedAt: observationDate,
                createdAt: nil,
                updatedAt: nil
            )
        }
        return MappedTile(tileID: body.tile, revision: body.revision,
                          generatedAt: generatedAt, sources: sources, spots: spots)
    }

    private static func mapHours(_ wire: TileOpeningHoursV1) throws -> SpotOpeningHours {
        let status = SpotOpeningHours.Status(rawValue: wire.status) ?? .unsupported
        guard !wire.timeZone.isEmpty else { throw TileSyncError.malformedResponse }
        if status == .parsed && wire.parsed == nil ||
            (status == .none || status == .unparsed) && wire.parsed != nil {
            throw TileSyncError.malformedResponse
        }
        let parsed: SpotParsedOpeningHours?
        if let value = wire.parsed {
            let kind: SpotParsedOpeningHours.Kind
            if value.v == 1 {
                kind = SpotParsedOpeningHours.Kind(rawValue: value.kind) ?? .unsupported
            } else {
                kind = .unsupported
            }
            if kind == .daily {
                guard let opens = value.opens, let closes = value.closes,
                      validTime(opens), validTime(closes, allowEndOfDay: true) else {
                    throw TileSyncError.malformedResponse
                }
            }
            parsed = SpotParsedOpeningHours(version: value.v, kind: kind,
                                            opens: value.opens, closes: value.closes)
        } else {
            parsed = nil
        }
        return SpotOpeningHours(raw: wire.raw, parsed: parsed, status: status,
                                timeZone: wire.timeZone)
    }

    private static func validTime(_ value: String, allowEndOfDay: Bool = false) -> Bool {
        if allowEndOfDay && value == "24:00" { return true }
        guard value.count == 5, value[value.index(value.startIndex, offsetBy: 2)] == ":",
              let hour = Int(value.prefix(2)), let minute = Int(value.suffix(2)) else { return false }
        return (0...23).contains(hour) && (0...59).contains(minute)
    }

    private static func validSpotID(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        guard bytes.count == 29, bytes.starts(with: [115, 112, 95]) else { return false }
        return bytes.dropFirst(3).allSatisfy {
            (48...57).contains($0) || (65...72).contains($0) ||
            (74...75).contains($0) || (77...78).contains($0) ||
            (80...84).contains($0) || (86...90).contains($0)
        }
    }

    private static func timestamp(_ value: String) -> Date? {
        guard value.count == 20, value.hasSuffix("Z") else { return nil }
        let format = ISO8601DateFormatter()
        format.formatOptions = [.withInternetDateTime]
        guard let date = format.date(from: value), format.string(from: date) == value else { return nil }
        return date
    }

    private static func observationDay(_ value: String) -> Date? {
        guard value.count == 10 else { return nil }
        let format = DateFormatter()
        format.calendar = Calendar(identifier: .gregorian)
        format.locale = Locale(identifier: "en_US_POSIX")
        format.timeZone = TimeZone(secondsFromGMT: 0)!
        format.dateFormat = "yyyy-MM-dd"
        format.isLenient = false
        guard let date = format.date(from: value), format.string(from: date) == value else { return nil }
        return date
    }
}
