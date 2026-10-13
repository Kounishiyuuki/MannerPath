import MapKit

@MainActor
final class MapKitDestinationSearch: DestinationSearching {
    private var activeSearches: [MKLocalSearch] = []
    // The region is only a ranking hint to MapKit; a 20 km one alone buries distant matches such as Tokyo's 上野駅
    // when searching from Kanazawa, so a Japan-wide search runs beside it (v1 storefront and data are Japan only).
    private static let japan = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 36.5, longitude: 137.0),
        span: MKCoordinateSpan(latitudeDelta: 22, longitudeDelta: 26)
    )

    func search(_ text: String, near origin: SpotCoordinate?) async throws -> [PlaceDestination] {
        activeSearches.forEach { $0.cancel() }
        let nearbySearch = origin.flatMap { origin -> MKLocalSearch? in
            guard origin.isValid else { return nil }
            return Self.search(text, region: MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: origin.latitude, longitude: origin.longitude),
                latitudinalMeters: 20_000, longitudinalMeters: 20_000
            ))
        }
        let nationwideSearch = Self.search(text, region: Self.japan)
        let searches = [nearbySearch, nationwideSearch].compactMap { $0 }
        activeSearches = searches
        defer { if activeSearches.elementsEqual(searches, by: ===) { activeSearches = [] } }
        // Either search may fail alone (MapKit reports "no results" as an error); only both failing is an error.
        var nearby: [PlaceDestination] = []
        var nearbyError: (any Error)?
        if let nearbySearch {
            do { nearby = try await Self.places(nearbySearch) } catch { nearbyError = error }
        }
        try Task.checkCancellation()
        let nationwide: [PlaceDestination]
        do {
            nationwide = try await Self.places(nationwideSearch)
        } catch {
            if nearbySearch == nil || nearbyError != nil { throw nearbyError ?? error }
            nationwide = []
        }
        try Task.checkCancellation()
        return DestinationResultMerger.merge(query: text, nearby: nearby, nationwide: nationwide)
    }

    private static func search(_ text: String, region: MKCoordinateRegion) -> MKLocalSearch {
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = text
        request.region = region
        return MKLocalSearch(request: request)
    }

    private static func places(_ search: MKLocalSearch) async throws -> [PlaceDestination] {
        let response = try await search.start()
        return response.mapItems.prefix(DestinationResultMerger.maximumResults).compactMap { item in
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
