// Implementations provide resolved domain spots, not API or persistence records.
protocol SpotRepository: Sendable {
    func allSpots() -> [Spot]
}

// A later Nearby integration can read one previously synchronized tile without networking.
nonisolated protocol CachedSpotRepository: Sendable {
    func spots(inTile tileID: String) async throws -> [Spot]
}
