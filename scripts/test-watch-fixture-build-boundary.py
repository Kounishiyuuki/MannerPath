#!/usr/bin/env python3
"""Compile the real shared Watch codec/store with and without DEBUG; no Xcode/Simulator."""
import pathlib
import re
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
SHARED = ROOT / "apps/apple/MannerPath/MannerPathWatchShared"
HARNESS = r'''
import Foundation

@main struct FixtureBuildBoundary {
    static func main() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = WatchStore(directory: directory)
        func payload(id: String, revision: UInt64) throws -> Data {
            let spot = WatchSpot(id: id, name: "Synthetic boundary test", latitude: 36.53, longitude: 136.64,
                spotType: "ashtray", accessType: "unknown", supportsPaper: "unknown", supportsHeated: "unknown",
                lifecycle: "active", evidenceQuality: nil, evidenceQualityVersion: nil, lastVerifiedAt: nil,
                openingHours: nil, sourceIDs: [])
            return try WatchCodec.encode(WatchSnapshot(schemaVersion: 1, revision: revision,
                generatedAt: Date(timeIntervalSince1970: 1_700_000_000), snapshotID: UUID(), spots: [spot], sources: []))
        }
        let fixture = try payload(id: "debug-watch-fixture-togashi", revision: 900)
        // Simulate upgrading a Debug installation without deleting its App Group cache.
        try fixture.write(to: directory.appendingPathComponent("nearby-watch-v1.json"))
        #if DEBUG
        let decoded = try WatchCodec.snapshot(fixture)
        precondition(decoded.spots.count == 1)
        precondition(store.snapshot()?.revision == 900)
        #else
        do {
            _ = try WatchCodec.snapshot(fixture)
            fatalError("Release decoded a Debug fixture")
        } catch WatchPayloadError.invalid { }
        precondition(store.snapshot() == nil, "Release exposed persisted fixture")
        do {
            _ = try store.acceptSnapshot(fixture)
            fatalError("Release persisted a Debug fixture")
        } catch WatchPayloadError.invalid { }
        #endif
        // Release must recover from a high-revision fixture rather than block genuine data.
        #if DEBUG
        try FileManager.default.removeItem(at: directory.appendingPathComponent("nearby-watch-v1.json"))
        #endif
        let normal = try payload(id: "normal-spot", revision: 1)
        let preferences = Data("preferences remain independent".utf8)
        let priorFixture = PhoneWatchContext.updatedContext(previous: ["snapshotV1": fixture],
            snapshotData: nil, preferenceData: preferences)
        let newFixture = PhoneWatchContext.updatedContext(previous: [:],
            snapshotData: fixture, preferenceData: preferences)
        #if DEBUG
        precondition(priorFixture["snapshotV1"] as? Data == fixture)
        precondition(newFixture["snapshotV1"] as? Data == fixture)
        #else
        precondition(priorFixture["snapshotV1"] == nil, "Release replayed old WC fixture context")
        precondition(newFixture["snapshotV1"] == nil, "Release accepted fixture replacement")
        #endif
        precondition(priorFixture["preferencesV1"] as? Data == preferences)
        let replaced = PhoneWatchContext.updatedContext(previous: ["snapshotV1": fixture],
            snapshotData: normal, preferenceData: nil)
        precondition(replaced["snapshotV1"] as? Data == normal)
        let invalidReplacement = PhoneWatchContext.updatedContext(previous: ["snapshotV1": normal],
            snapshotData: Data("malformed".utf8), preferenceData: nil)
        precondition(invalidReplacement["snapshotV1"] as? Data == normal)
        _ = try store.acceptSnapshot(normal)
        precondition(store.snapshot()?.spots.first?.id == "normal-spot")
    }
}
'''

with tempfile.TemporaryDirectory(prefix="mannerpath-watch-boundary-") as temporary:
    folder = pathlib.Path(temporary)
    harness = folder / "FixtureBuildBoundary.swift"
    # Compile the production method rather than a copied implementation. The outer WCSession
    # delegate cannot compile on macOS, but this pure context function needs only the codec.
    producer = ROOT / "apps/apple/MannerPath/MannerPath/Core/WatchSync/PhoneWatchSync.swift"
    context_method = re.search(r"^    static func updatedContext\(.*?^    \}",
                               producer.read_text(), re.MULTILINE | re.DOTALL)
    if context_method is None:
        raise RuntimeError("PhoneWatchSync.updatedContext not found; update the boundary harness")
    harness.write_text(HARNESS + "\nnonisolated enum PhoneWatchContext {\n" +
                       context_method.group(0) + "\n}\n")
    for debug in (False, True):
        binary = folder / ("Debug" if debug else "Release")
        subprocess.run(["swiftc", "-module-cache-path", str(folder / "module-cache"),
                        *(["-D", "DEBUG"] if debug else []),
                        str(SHARED / "ApproximateLocation.swift"), str(SHARED / "WatchSnapshot.swift"),
                        str(SHARED / "WatchStore.swift"), str(harness), "-o", str(binary)], check=True)
        subprocess.run([str(binary)], check=True)
        print(f"Watch fixture codec/store boundary: {binary.name} passed")
