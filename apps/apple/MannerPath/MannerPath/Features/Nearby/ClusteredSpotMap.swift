import MapKit
import SwiftUI
import UIKit

// Nearby map with MapKit's native annotation clustering (Issue #158). A dense area (#156: ~2,000 spots in ~110 m)
// would otherwise render thousands of overlapping markers. Clustering is PRESENTATION ONLY: every result keeps its
// own annotation with its canonical spot id, and the ranking, filtering, list and publication are untouched —
// MapKit merely draws nearby spot annotations as one cluster marker at low zoom and splits them as the user zooms in.

/// One drawable item per map element. Spot items correspond 1:1, in order, to the logical results.
struct SpotMapItem: Equatable {
    enum Kind: Equatable, Sendable {
        case spot(id: String, existence: ExistenceEvidence)
        case userLocation
        case destination
    }

    let kind: Kind
    let latitude: Double
    let longitude: Double
    let title: String
    let accessibilityLabel: String
    let accessibilityValue: String?

    /// The map content for a result list: one spot item per result (same ids, same order) plus the user location and
    /// destination markers, which never cluster. Pure, so tests can prove clustering cannot change the result list.
    static func items(results: [NearbyResult], location: DeviceLocation?, locationLabel: String,
                      destination: (name: String, coordinate: SpotCoordinate)?) -> [SpotMapItem] {
        var items: [SpotMapItem] = results.map { result in
            let name = SpotPresentation.name(result.spot)
            return SpotMapItem(kind: .spot(id: result.spot.id, existence: result.spot.verification.existenceTier),
                               latitude: result.spot.latitude, longitude: result.spot.longitude, title: name,
                               accessibilityLabel: String(localized: "Show details for \(name)"),
                               accessibilityValue: SpotPresentation.evidence(result.spot))
        }
        if let location {
            items.append(SpotMapItem(kind: .userLocation, latitude: location.coordinate.latitude,
                                     longitude: location.coordinate.longitude, title: locationLabel,
                                     accessibilityLabel: locationLabel, accessibilityValue: nil))
        }
        if let destination {
            let label = String(localized: "Destination: \(destination.name)")
            items.append(SpotMapItem(kind: .destination, latitude: destination.coordinate.latitude,
                                     longitude: destination.coordinate.longitude, title: label,
                                     accessibilityLabel: label, accessibilityValue: nil))
        }
        return items
    }
}

final class SpotMapAnnotation: NSObject, MKAnnotation {
    let item: SpotMapItem
    let coordinate: CLLocationCoordinate2D
    var title: String? { item.title }

    init(item: SpotMapItem) {
        self.item = item
        coordinate = CLLocationCoordinate2D(latitude: item.latitude, longitude: item.longitude)
    }

    /// Identity for diffing: a spot by its canonical id, the two singleton markers by kind.
    var key: String {
        switch item.kind {
        case .spot(let id, _): "spot:\(id)"
        case .userLocation: "user"
        case .destination: "destination"
        }
    }
}

struct ClusteredSpotMap: UIViewRepresentable {
    static let spotClusterIdentifier = "nearbySpots"

    let items: [SpotMapItem]
    /// A region requested by the screen (recenter); applied when it changes.
    let region: MKCoordinateRegion?
    let onSelectSpot: (String) -> Void
    let onUserMovedMap: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.delegate = context.coordinator
        map.pointOfInterestFilter = .excludingAll
        map.accessibilityIdentifier = "nearbyMap"
        map.register(MKMarkerAnnotationView.self, forAnnotationViewWithReuseIdentifier: Coordinator.spotReuse)
        map.register(MKMarkerAnnotationView.self, forAnnotationViewWithReuseIdentifier: Coordinator.markerReuse)
        map.register(MKMarkerAnnotationView.self,
                     forAnnotationViewWithReuseIdentifier: MKMapViewDefaultClusterAnnotationViewReuseIdentifier)
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.sync(map, items: items)
        if let region, context.coordinator.appliedRegion.map({ !Self.same($0, region) }) ?? true {
            context.coordinator.appliedRegion = region
            context.coordinator.settingRegion = true
            map.setRegion(region, animated: context.coordinator.hasAppliedRegion)
            context.coordinator.hasAppliedRegion = true
        }
    }

    private static func same(_ a: MKCoordinateRegion, _ b: MKCoordinateRegion) -> Bool {
        a.center.latitude == b.center.latitude && a.center.longitude == b.center.longitude
            && a.span.latitudeDelta == b.span.latitudeDelta && a.span.longitudeDelta == b.span.longitudeDelta
    }

    final class Coordinator: NSObject, MKMapViewDelegate {
        static let spotReuse = "nearbySpot"
        static let markerReuse = "nearbyMarker"
        var parent: ClusteredSpotMap
        var appliedRegion: MKCoordinateRegion?
        var hasAppliedRegion = false
        var settingRegion = false
        private var annotations: [String: SpotMapAnnotation] = [:]

        init(_ parent: ClusteredSpotMap) { self.parent = parent }

        /// Adds, removes and replaces annotations so the map shows exactly `items` (one per spot result).
        func sync(_ map: MKMapView, items: [SpotMapItem]) {
            var wanted: [String: SpotMapAnnotation] = [:]
            for item in items {
                let annotation = SpotMapAnnotation(item: item)
                wanted[annotation.key] = annotations[annotation.key].flatMap { $0.item == item ? $0 : nil } ?? annotation
            }
            let stale = annotations.filter { wanted[$0.key] !== $0.value }.map(\.value)
            let added = wanted.filter { annotations[$0.key] !== $0.value }.map(\.value)
            map.removeAnnotations(stale)
            map.addAnnotations(added)
            annotations = wanted
        }

        func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            if let cluster = annotation as? MKClusterAnnotation {
                let view = mapView.dequeueReusableAnnotationView(
                    withIdentifier: MKMapViewDefaultClusterAnnotationViewReuseIdentifier, for: cluster) as? MKMarkerAnnotationView
                view?.markerTintColor = .systemRed
                view?.glyphText = "\(cluster.memberAnnotations.count)"
                view?.isAccessibilityElement = true
                view?.accessibilityLabel = String(localized: "\(cluster.memberAnnotations.count) nearby places. Zoom in to see each one")
                view?.accessibilityTraits = .button
                return view
            }
            guard let annotation = annotation as? SpotMapAnnotation else { return nil }
            switch annotation.item.kind {
            case .spot(_, let existence):
                let view = mapView.dequeueReusableAnnotationView(withIdentifier: Self.spotReuse, for: annotation) as? MKMarkerAnnotationView
                view?.clusteringIdentifier = ClusteredSpotMap.spotClusterIdentifier
                view?.markerTintColor = Self.tint(existence)
                view?.glyphImage = UIImage(systemName: existence == .communityReported || existence == .unknown ? "mappin" : "mappin.circle.fill")
                view?.displayPriority = .defaultHigh
                view?.titleVisibility = .hidden
                view?.isAccessibilityElement = true
                view?.accessibilityLabel = annotation.item.accessibilityLabel
                view?.accessibilityValue = annotation.item.accessibilityValue
                view?.accessibilityTraits = .button
                return view
            case .userLocation, .destination:
                let view = mapView.dequeueReusableAnnotationView(withIdentifier: Self.markerReuse, for: annotation) as? MKMarkerAnnotationView
                view?.clusteringIdentifier = nil
                view?.displayPriority = .required
                view?.markerTintColor = .systemBlue
                view?.glyphImage = UIImage(systemName: annotation.item.kind == .destination ? "flag.checkered" : "location.fill")
                view?.titleVisibility = .hidden
                view?.isAccessibilityElement = true
                view?.accessibilityLabel = annotation.item.accessibilityLabel
                return view
            }
        }

        func mapView(_ mapView: MKMapView, didSelect annotation: MKAnnotation) {
            if let cluster = annotation as? MKClusterAnnotation {
                // Zoom to the members; the cluster splits into individual pins.
                mapView.showAnnotations(cluster.memberAnnotations, animated: true)
                mapView.deselectAnnotation(cluster, animated: false)
                return
            }
            guard let spot = annotation as? SpotMapAnnotation else { return }
            mapView.deselectAnnotation(spot, animated: false)
            if case .spot(let id, _) = spot.item.kind { parent.onSelectSpot(id) }
        }

        func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
            if settingRegion {
                settingRegion = false
            } else {
                parent.onUserMovedMap()
            }
        }

        // Official and community listings stay apart without alarming colours (as the previous SwiftUI pin): red for
        // official/operator evidence, orange for user-confirmed places, grey for a single report.
        private static func tint(_ existence: ExistenceEvidence) -> UIColor {
            switch existence {
            case .official, .operator: .systemRed
            case .communityVerified: .systemOrange
            case .communityReported, .unknown: .systemGray
            }
        }
    }
}
