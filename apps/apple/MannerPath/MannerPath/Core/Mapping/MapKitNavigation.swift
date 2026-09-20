import MapKit

@MainActor
final class MapKitDestinationSearch: DestinationSearching {
    private var activeSearch: MKLocalSearch?

    func search(_ text: String, near origin: SpotCoordinate?) async throws -> [PlaceDestination] {
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = text
        if let origin, origin.isValid {
            request.region = MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: origin.latitude, longitude: origin.longitude),
                latitudinalMeters: 20_000, longitudinalMeters: 20_000
            )
        }
        activeSearch?.cancel()
        let search = MKLocalSearch(request: request)
        activeSearch = search
        defer { if activeSearch === search { activeSearch = nil } }
        let response = try await search.start()
        try Task.checkCancellation()
        return response.mapItems.prefix(8).compactMap { item in
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
