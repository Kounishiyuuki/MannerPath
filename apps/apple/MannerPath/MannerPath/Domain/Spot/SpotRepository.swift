// Implementations provide resolved domain spots, not API or persistence records.
protocol SpotRepository: Sendable {
    func allSpots() -> [Spot]
}
