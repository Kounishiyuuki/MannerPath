// Implementations provide resolved domain spots, not API or persistence records.
protocol SpotRepository: Sendable {
    func allSpots() -> [Spot]
}

nonisolated protocol CachedSpotRepository: Sendable {
    func spots(inTile tileID: String) async throws -> [Spot]
    func sources(inTile tileID: String) async throws -> [SpotSource]
    func dataZoom() async -> Int
}

extension CachedSpotRepository {
    /// The data zoom the cache is keyed by (the configured `dataTileZoom`, Issue #158). A repository without a
    /// configured namespace serves the compiled-in default.
    nonisolated func dataZoom() async -> Int { SlippyTile.dataZoom }
}
