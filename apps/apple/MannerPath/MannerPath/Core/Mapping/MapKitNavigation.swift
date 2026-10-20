import MapKit

@MainActor
final class MapKitDestinationSearch: DestinationSearching {
    private var activeSearches: [MKLocalSearch] = []

    /// A 20 km region alone makes MapKit answer only local places (from Kanazawa, "上野駅" returned Kanazawa
    /// stations), so the nearby search runs alongside a nationwide one and the results are merged.
    static let nationwideRegion = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 36.0, longitude: 137.5),
        span: MKCoordinateSpan(latitudeDelta: 22, longitudeDelta: 24)
    )

    func search(_ text: String, near origin: SpotCoordinate?) async throws -> [PlaceDestination] {
        activeSearches.forEach { $0.cancel() }
        var regions = [Self.nationwideRegion]
        if let origin, origin.isValid {
            regions.insert(MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: origin.latitude, longitude: origin.longitude),
                latitudinalMeters: 20_000, longitudinalMeters: 20_000
            ), at: 0)
        }
        let searches = regions.map { Self.makeSearch(text, in: $0, priority: .default) }
        activeSearches = searches
        defer { if activeSearches.first === searches.first { activeSearches = [] } }
        var lists: [[PlaceDestination]] = []
        var lastError: (any Error)?
        for search in searches {
            do {
                lists.append(Self.destinations(try await search.start()))
            } catch {
                try Task.checkCancellation()
                lastError = error
                lists.append([])
            }
        }
        try Task.checkCancellation()
        // The region is only a hint: on a device in Kanazawa the nationwide search can still answer local stations for
        // "上野駅". When no answer is named for the query, ask once more with the nationwide region required.
        if !DestinationResultMerger.containsNameMatch(for: text, in: lists.flatMap { $0 }) {
            let strict = Self.makeSearch(text, in: Self.nationwideRegion, priority: .required)
            activeSearches.append(strict)
            if let response = try? await strict.start() {
                lists[lists.count - 1] = Self.destinations(response) + lists[lists.count - 1]
            }
            try Task.checkCancellation()
        }
        if let lastError, lists.allSatisfy(\.isEmpty) { throw lastError }
        return lists.count == 2
            ? DestinationResultMerger.merge(query: text, nearby: lists[0], nationwide: lists[1])
            : DestinationResultMerger.merge(query: text, nearby: [], nationwide: lists[0])
    }

    private static func makeSearch(_ text: String, in region: MKCoordinateRegion,
                                   priority: MKLocalSearchRegionPriority) -> MKLocalSearch {
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = text
        request.region = region
        request.regionPriority = priority
        return MKLocalSearch(request: request)
    }

    private static func destinations(_ response: MKLocalSearch.Response) -> [PlaceDestination] {
        response.mapItems.prefix(8).compactMap { item in
            let coordinate = SpotCoordinate(
                latitude: item.placemark.coordinate.latitude,
                longitude: item.placemark.coordinate.longitude
            )
            guard coordinate.isValid else { return nil }
            return PlaceDestination(
                id: UUID(), name: item.name ?? "Destination", subtitle: item.placemark.title,
                coordinate: coordinate
            )
        }
    }
}

@MainActor
final class MapKitWalkingRouter: WalkingRouting {
    private var activeDirections: MKDirections?

    func cancel() {
        activeDirections?.cancel()
        activeDirections = nil
    }

    func route(from start: SpotCoordinate, to end: SpotCoordinate) async throws -> WalkingRoute {
        let request = MKDirections.Request()
        request.source = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(
            latitude: start.latitude, longitude: start.longitude
        )))
        request.destination = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(
            latitude: end.latitude, longitude: end.longitude
        )))
        request.transportType = .walking
        request.requestsAlternateRoutes = false
        cancel()
        let directions = MKDirections(request: request)
        activeDirections = directions
        defer { if activeDirections === directions { activeDirections = nil } }
        let response = try await directions.calculate()
        try Task.checkCancellation()
        guard let route = response.routes.first,
              route.expectedTravelTime.isFinite, route.expectedTravelTime >= 0,
              route.distance.isFinite, route.distance >= 0 else { throw MapKitRoutingError.noRoute }
        let line = route.polyline
        var points = [CLLocationCoordinate2D](repeating: kCLLocationCoordinate2DInvalid, count: line.pointCount)
        line.getCoordinates(&points, range: NSRange(location: 0, length: line.pointCount))
        return WalkingRoute(
            travelTime: route.expectedTravelTime,
            distanceMeters: route.distance,
            geometry: points.map { SpotCoordinate(latitude: $0.latitude, longitude: $0.longitude) }
        )
    }
}

private enum MapKitRoutingError: Error { case noRoute }

@MainActor
enum AppleMapsHandoff {
    static func openWalkingDirections(to spot: Spot) {
        let item = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(
            latitude: spot.latitude, longitude: spot.longitude
        )))
        item.name = spot.name ?? "Permitted smoking place"
        item.openInMaps(launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeWalking])
    }
}
