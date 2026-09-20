// Implementations provide resolved domain spots, not API or persistence records.
protocol SpotRepository: Sendable {
    func allSpots() -> [Spot]
}

nonisolated protocol CachedSpotRepository: Sendable {
    func spots(inTile tileID: String) async throws -> [Spot]
    func sources(inTile tileID: String) async throws -> [SpotSource]
}
