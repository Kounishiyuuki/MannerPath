// Implementations provide resolved domain spots, not API or persistence records.
protocol SpotRepository: Sendable {
    func allSpots() -> [Spot]
}

nonisolated protocol CachedSpotRepository: Sendable {
    func spots(inTile tileID: String) async throws -> [Spot]
    func sources(inTile tileID: String) async throws -> [SpotSource]
    /// The data tile zoom the cached tiles are partitioned at; tile IDs passed in must use it.
    func dataZoom() async throws -> Int
}
