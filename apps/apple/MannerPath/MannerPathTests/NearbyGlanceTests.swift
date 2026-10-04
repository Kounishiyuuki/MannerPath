import AppIntents
import Foundation
import Testing
@testable import MannerPath

struct NearbyGlanceTests {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    @Test func freshStaleEmptyAndDecode() throws {
        let fresh = NearbyGlance(version: 1, computedAt: now, locationObservedAt: now, locationIsLastKnown: false, spotID: "spot1", name: "Place",
                                 distanceMeters: 120, lastVerifiedAt: nil)
        #expect(try NearbyGlanceCodec.decode(NearbyGlanceCodec.encode(fresh)) == fresh)
        #expect(fresh.state(at: now.addingTimeInterval(3_600)) == .fresh)
        #expect(fresh.state(at: now.addingTimeInterval(3_601)) == .stale)
        let oldLocation = NearbyGlance(version: 1, computedAt: now,
                                       locationObservedAt: now.addingTimeInterval(-3_601),
                                       locationIsLastKnown: true, spotID: "spot1", name: "Place",
                                       distanceMeters: 120, lastVerifiedAt: nil)
        #expect(oldLocation.state(at: now) == .stale)
        let empty = NearbyGlance(version: 1, computedAt: now, locationObservedAt: now, locationIsLastKnown: false, spotID: nil, name: nil,
                                 distanceMeters: nil, lastVerifiedAt: nil)
        #expect(empty.state(at: now) == .empty)
        #expect(empty.state(at: now.addingTimeInterval(3_601)) == .stale)
    }

    @Test func malformedAndUnavailable() throws {
        #expect(throws: Error.self) { try NearbyGlanceCodec.decode(Data("{}".utf8)) }
        #expect(NearbyGlanceFile.read(from: nil) == nil)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try Data("malformed".utf8).write(to: directory.appendingPathComponent(NearbyGlanceFile.filename))
        #expect(NearbyGlanceFile.read(from: directory) == nil)
        let saved = NearbyGlance(version: 1, computedAt: now, locationObservedAt: now,
                                 locationIsLastKnown: false, spotID: nil, name: nil,
                                 distanceMeters: nil, lastVerifiedAt: nil)
        try NearbyGlanceFile.write(saved, to: directory)
        #expect(NearbyGlanceFile.read(from: directory) == saved)
        let bad = NearbyGlance(version: 1, computedAt: now, locationObservedAt: now, locationIsLastKnown: false, spotID: "spot", name: "Place",
                               distanceMeters: -.infinity, lastVerifiedAt: nil)
        #expect(throws: Error.self) { try NearbyGlanceCodec.encode(bad) }
    }

    @Test func existenceTierRoundTripsAndOlderGlanceReadsUnknown() throws {
        let tiered = NearbyGlance(version: 1, computedAt: now, locationObservedAt: now, locationIsLastKnown: false, spotID: "spot1", name: "Place",
                                  distanceMeters: 120, lastVerifiedAt: nil, existence: "communityReported")
        let decoded = try NearbyGlanceCodec.decode(NearbyGlanceCodec.encode(tiered))
        #expect(decoded.existence == "communityReported")
        #expect(decoded.existenceLabel == String(localized: "User report · unconfirmed"))
        let older = try NearbyGlanceCodec.decode(Data(#"{"version":1,"computedAt":1800000000,"locationObservedAt":1800000000,"locationIsLastKnown":false,"spotID":"s","name":"P","distanceMeters":1}"#.utf8))
        #expect(older.existence == nil)
        #expect(older.existenceLabel == String(localized: "Confirmation status unknown"))
        let future = NearbyGlance(version: 1, computedAt: now, locationObservedAt: now, locationIsLastKnown: false, spotID: "s", name: "P",
                                  distanceMeters: 1, lastVerifiedAt: nil, existence: "openData")
        #expect(future.existenceLabel == String(localized: "Confirmation status unknown"))
        for (raw, label) in [("official", "Officially confirmed"), ("operator", "Confirmed by the operator"),
                             ("communityVerified", "Confirmed by users")] {
            let value = NearbyGlance(version: 1, computedAt: now, locationObservedAt: now, locationIsLastKnown: false, spotID: "s", name: "P",
                                     distanceMeters: 1, lastVerifiedAt: nil, existence: raw)
            #expect(value.existenceLabel == String(localized: String.LocalizationValue(label)))
        }
    }

    @Test func appIntentOpensApp() async throws {
        #expect(OpenNearbyIntent.openAppWhenRun)
        _ = try await OpenNearbyIntent().perform()
    }

    @Test func deepLinks() {
        let value = NearbyGlance(version: 1, computedAt: now, locationObservedAt: now, locationIsLastKnown: false, spotID: "sp_a?b", name: "Place",
                                 distanceMeters: 1, lastVerifiedAt: nil)
        #expect(NearbyGlance.spotID(from: value.deepLink) == .some("sp_a?b"))
        #expect(NearbyGlance.spotID(from: URL(string: "mannerpath://nearby")!) == .some(nil))
        #expect(NearbyGlance.spotID(from: URL(string: "https://nearby")!) == nil)
        #expect(NearbyGlance.spotID(from: URL(string: "mannerpath://user@nearby")!) == nil)
        #expect(NearbyGlance.spotID(from: URL(string: "mannerpath://nearby:123")!) == nil)
        #expect(NearbyGlance.spotID(from: URL(string: "mannerpath://nearby#fragment")!) == nil)
    }
}
