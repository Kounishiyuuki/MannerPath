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
    }
}
