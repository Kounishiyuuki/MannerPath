import MapKit
import SwiftUI
import UIKit

// The Nearby map. A dense tile can hold thousands of spots (ADR-0015), so pins go through MapKit's native
// clustering (MKMapView `clusteringIdentifier`) rather than one SwiftUI annotation each; SwiftUI's Map has no
// clustering on iOS 18. Only what the list shows is drawn: the filtered, ranked results.

/// One spot pin, as plain data, so the update diff and cluster appearance are testable without a map.
nonisolated struct SpotMapPin: Equatable, Sendable {
    let id: String
    let title: String
    let coordinate: SpotCoordinate
    let existence: ExistenceEvidence
    let accessibilityValue: String
}

nonisolated enum SpotMapAnnotationDiff {
    /// Annotations to remove (gone or changed) and to add (new or changed). Unchanged pins keep their annotation,
    /// so a refresh of a 2,000-spot tile does not re-cluster everything.
    static func diff(current: [String: SpotMapPin], next: [SpotMapPin]) -> (remove: [String], add: [SpotMapPin]) {
        let nextByID = Dictionary(next.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let remove = current.filter { nextByID[$0.key] != $0.value }.map(\.key).sorted()
        let add = nextByID.values.filter { current[$0.id] != $0 }.sorted { $0.id < $1.id }
        return (remove, add)
    }
}

nonisolated enum SpotMapCluster {
    /// A cluster takes the strongest existence evidence among its members, so a cluster that holds an official spot
    /// never looks like an unverified one.
    static func existence(of members: [ExistenceEvidence]) -> ExistenceEvidence {
        let order: [ExistenceEvidence] = [.official, .operator, .communityVerified, .communityReported, .unknown]
        return order.first(where: members.contains) ?? .unknown
    }

    /// The region that shows every member of a tapped cluster: cluster expansion. The minimum span keeps members that
    /// share a building apart only as far as MapKit can still separate them.
    static func expansionRegion(for coordinates: [SpotCoordinate]) -> MKCoordinateRegion? {
        guard let first = coordinates.first else { return nil }
        var minLat = first.latitude, maxLat = first.latitude, minLon = first.longitude, maxLon = first.longitude
        for c in coordinates {
            minLat = min(minLat, c.latitude); maxLat = max(maxLat, c.latitude)
            minLon = min(minLon, c.longitude); maxLon = max(maxLon, c.longitude)
        }
        return MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2),
            span: MKCoordinateSpan(latitudeDelta: max(0.0008, (maxLat - minLat) * 1.5),
                                   longitudeDelta: max(0.0008, (maxLon - minLon) * 1.5)))
    }

    // Tells official and community listings apart without alarming colours: red for official/operator evidence,
    // orange for user-confirmed places, grey (with an outline glyph) for a single report.
    static func tint(_ existence: ExistenceEvidence) -> UIColor {
        switch existence {
        case .official, .operator: .systemRed
        case .communityVerified: .systemOrange
        case .communityReported, .unknown: .systemGray
        }
    }
}

private nonisolated final class SpotAnnotation: MKPointAnnotation {
    let pin: SpotMapPin
    init(_ pin: SpotMapPin) {
        self.pin = pin
        super.init()
        title = pin.title
        coordinate = CLLocationCoordinate2D(latitude: pin.coordinate.latitude, longitude: pin.coordinate.longitude)
    }
}

/// The user's position and the destination: never clustered, never hidden by a cluster.
private nonisolated final class FixedAnnotation: MKPointAnnotation {
    enum Kind { case user, destination }
    let kind: Kind
    init(kind: Kind, title: String, coordinate: SpotCoordinate) {
        self.kind = kind
        super.init()
        self.title = title
        self.coordinate = CLLocationCoordinate2D(latitude: coordinate.latitude, longitude: coordinate.longitude)
    }
}

/// MapKit keeps the reusable views of clustered members alive but hidden; VoiceOver must only see what is drawn.
private final class VisibleMarkerView: MKMarkerAnnotationView {
    override var isAccessibilityElement: Bool {
        get { !isHidden && alpha > 0 && window != nil && annotation != nil }
        set {}
    }
}

struct ClusteredSpotMap: UIViewRepresentable {
    struct Marker: Equatable {
        let title: String
        let coordinate: SpotCoordinate
    }

    let pins: [SpotMapPin]
    let user: Marker?
    let destination: Marker?
    /// Applied whenever `regionRequest` changes (Recenter, new results); otherwise the user's camera is kept.
    let region: MKCoordinateRegion?
    let regionRequest: Int
    let onUserMovedMap: () -> Void
    let onSelectSpot: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.delegate = context.coordinator
        map.pointOfInterestFilter = .excludingAll
        map.register(VisibleMarkerView.self, forAnnotationViewWithReuseIdentifier: Coordinator.spotReuse)
        map.register(VisibleMarkerView.self, forAnnotationViewWithReuseIdentifier: Coordinator.clusterReuse)
        map.register(MKMarkerAnnotationView.self, forAnnotationViewWithReuseIdentifier: Coordinator.fixedReuse)
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        let coordinator = context.coordinator
        coordinator.onUserMovedMap = onUserMovedMap
        coordinator.onSelectSpot = onSelectSpot

        let (remove, add) = SpotMapAnnotationDiff.diff(current: coordinator.pins.mapValues(\.pin), next: pins)
        map.removeAnnotations(remove.compactMap { coordinator.pins.removeValue(forKey: $0) })
        let added = add.map(SpotAnnotation.init)
        for annotation in added { coordinator.pins[annotation.pin.id] = annotation }
        map.addAnnotations(added)

        coordinator.setFixed(.user, user, on: map)
        coordinator.setFixed(.destination, destination, on: map)

        if regionRequest != coordinator.appliedRegionRequest, let region {
            coordinator.appliedRegionRequest = regionRequest
            map.setRegion(region, animated: coordinator.hasAppliedRegion)
            coordinator.hasAppliedRegion = true
        }
    }

    @MainActor
    final class Coordinator: NSObject, MKMapViewDelegate {
        static let spotReuse = "spot"
        static let clusterReuse = "spotCluster"
        static let fixedReuse = "fixed"
        private static let clusteringIdentifier = "nearbySpots"

        fileprivate var pins: [String: SpotAnnotation] = [:]
        private var fixed: [FixedAnnotation.Kind: (FixedAnnotation, Marker)] = [:]
        var appliedRegionRequest: Int?
        var hasAppliedRegion = false
        var onUserMovedMap: () -> Void = {}
        var onSelectSpot: (String) -> Void = { _ in }

        fileprivate func setFixed(_ kind: FixedAnnotation.Kind, _ marker: Marker?, on map: MKMapView) {
            if let (annotation, current) = fixed[kind] {
                if current == marker { return }
                map.removeAnnotation(annotation)
                fixed[kind] = nil
            }
            guard let marker else { return }
            let annotation = FixedAnnotation(kind: kind, title: marker.title, coordinate: marker.coordinate)
            fixed[kind] = (annotation, marker)
            map.addAnnotation(annotation)
        }

        func mapView(_ mapView: MKMapView, viewFor annotation: any MKAnnotation) -> MKAnnotationView? {
            switch annotation {
            case let spot as SpotAnnotation:
                let view = mapView.dequeueReusableAnnotationView(withIdentifier: Self.spotReuse, for: spot) as! MKMarkerAnnotationView
                view.clusteringIdentifier = Self.clusteringIdentifier
                view.displayPriority = .defaultHigh
                view.canShowCallout = false
                view.markerTintColor = SpotMapCluster.tint(spot.pin.existence)
                view.glyphImage = UIImage(systemName: spot.pin.existence == .communityReported || spot.pin.existence == .unknown
                                          ? "mappin" : "mappin.circle.fill")
                view.accessibilityLabel = String(localized: "Show details for \(spot.pin.title)")
                view.accessibilityValue = spot.pin.accessibilityValue
                view.accessibilityTraits = .button
                return view
            case let cluster as MKClusterAnnotation:
                let view = mapView.dequeueReusableAnnotationView(withIdentifier: Self.clusterReuse, for: cluster) as! MKMarkerAnnotationView
                let members = cluster.memberAnnotations.compactMap { ($0 as? SpotAnnotation)?.pin.existence }
                view.markerTintColor = SpotMapCluster.tint(SpotMapCluster.existence(of: members))
                view.glyphText = "\(cluster.memberAnnotations.count)"
                view.displayPriority = .defaultHigh
                view.canShowCallout = false
                view.accessibilityLabel = String(localized: "\(cluster.memberAnnotations.count) places")
                view.accessibilityHint = String(localized: "Zooms in to separate them")
                view.accessibilityTraits = .button
                return view
            case let fixed as FixedAnnotation:
                let view = mapView.dequeueReusableAnnotationView(withIdentifier: Self.fixedReuse, for: fixed) as! MKMarkerAnnotationView
                view.clusteringIdentifier = nil
                view.displayPriority = .required
                view.canShowCallout = false
                view.markerTintColor = .systemBlue
                view.glyphImage = UIImage(systemName: fixed.kind == .user ? "location.fill" : "flag.checkered")
                view.isAccessibilityElement = true
                view.accessibilityLabel = fixed.title
                return view
            default:
                return nil
            }
        }

        func mapView(_ mapView: MKMapView, didSelect annotation: any MKAnnotation) {
            mapView.deselectAnnotation(annotation, animated: false)
            switch annotation {
            case let cluster as MKClusterAnnotation:
                let coordinates = cluster.memberAnnotations.map {
                    SpotCoordinate(latitude: $0.coordinate.latitude, longitude: $0.coordinate.longitude)
                }
                guard let region = SpotMapCluster.expansionRegion(for: coordinates) else { return }
                onUserMovedMap()
                mapView.setRegion(region, animated: true)
            case let spot as SpotAnnotation:
                onSelectSpot(spot.pin.id)
            default:
                break
            }
        }

        func mapView(_ mapView: MKMapView, regionWillChangeAnimated animated: Bool) {
            // Only a pan or pinch counts as the user positioning the map; programmatic recentering does not.
            let gesturing = mapView.subviews.first?.gestureRecognizers?.contains {
                $0.state == .began || $0.state == .changed || $0.state == .ended
            } ?? false
            if gesturing { onUserMovedMap() }
        }
    }
}
