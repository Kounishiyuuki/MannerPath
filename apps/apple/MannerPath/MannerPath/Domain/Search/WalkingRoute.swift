import Foundation

struct PlaceDestination: Identifiable, Equatable, Sendable {
    let id: UUID
    let name: String
    let subtitle: String?
    let coordinate: SpotCoordinate

    init(id: UUID, name: String, subtitle: String? = nil, coordinate: SpotCoordinate) {
        self.id = id
        self.name = name
        self.subtitle = subtitle
        self.coordinate = coordinate
    }
}

struct WalkingRoute: Sendable {
    let travelTime: TimeInterval
    let distanceMeters: Double
    let geometry: [SpotCoordinate]
}

@MainActor
protocol DestinationSearching {
    func search(_ text: String, near origin: SpotCoordinate?) async throws -> [PlaceDestination]
}

@MainActor
protocol WalkingRouting {
    func route(from start: SpotCoordinate, to end: SpotCoordinate) async throws -> WalkingRoute
    func cancel()
}

struct RouteRankedResult: Sendable {
    let nearby: NearbyResult
    let detourSeconds: TimeInterval?
}

enum RouteDetourRanker {
    static let algorithmVersion = 1
    static let maximumRoutedCandidates = 5
    static let maximumDirectionsRequests = 1 + 2 * maximumRoutedCandidates

    // Straight-line excess is only a lower-cost shortlist heuristic. Actual ranking uses walking ETAs.
    static func candidates(
        _ results: [NearbyResult], from origin: SpotCoordinate, to destination: SpotCoordinate
    ) -> [NearbyResult] {
        let direct = NearbySearch.straightLineDistance(from: origin, to: destination)
        return Array(results.sorted {
            let first = excess($0, origin: origin, destination: destination, direct: direct)
            let second = excess($1, origin: origin, destination: destination, direct: direct)
            if first != second { return first < second }
            return $0.spot.id < $1.spot.id
        }.prefix(maximumRoutedCandidates))
    }

    static func detourSeconds(direct: TimeInterval, viaSpot: TimeInterval, onward: TimeInterval) -> TimeInterval? {
        guard direct.isFinite, viaSpot.isFinite, onward.isFinite,
              direct >= 0, viaSpot >= 0, onward >= 0 else { return nil }
        let viaTotal = viaSpot + onward
        guard viaTotal.isFinite else { return nil }
        return max(0, viaTotal - direct)
    }

    static func rank(_ results: [NearbyResult], detours: [String: TimeInterval]) -> [RouteRankedResult] {
        results.map { RouteRankedResult(nearby: $0, detourSeconds: detours[$0.spot.id]) }
            .sorted {
                switch ($0.detourSeconds, $1.detourSeconds) {
                case let (first?, second?):
                    if first != second { return first < second }
                case (_?, nil): return true
                case (nil, _?): return false
                case (nil, nil): break
                }
                if $0.nearby.distanceMeters != $1.nearby.distanceMeters {
                    return $0.nearby.distanceMeters < $1.nearby.distanceMeters
                }
                return $0.nearby.spot.id < $1.nearby.spot.id
            }
    }

    private static func excess(
        _ result: NearbyResult, origin: SpotCoordinate, destination: SpotCoordinate, direct: Double
    ) -> Double {
        let spot = SpotCoordinate(latitude: result.spot.latitude, longitude: result.spot.longitude)
        return result.distanceMeters + NearbySearch.straightLineDistance(from: spot, to: destination) - direct
    }
}
