import CoreLocation
import Foundation

struct DeviceLocation: Sendable {
    let coordinate: SpotCoordinate
    let timestamp: Date
    let horizontalAccuracyMeters: Double
    let isApproximate: Bool
    let isLastKnown: Bool
}

enum NearbyLocationState: Sendable {
    case notDetermined
    case locating
    case denied
    case restricted
    case unavailable
    case usable(DeviceLocation)
}

@MainActor
protocol LocationProviding: AnyObject {
    var state: NearbyLocationState { get }
    var onStateChange: (@MainActor (NearbyLocationState) -> Void)? { get set }
    func refresh()
}

@MainActor
final class DeviceLocationService: NSObject, LocationProviding, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var lastLocation: CLLocation?

    private(set) var state: NearbyLocationState = .notDetermined {
        didSet { onStateChange?(state) }
    }
    var onStateChange: (@MainActor (NearbyLocationState) -> Void)?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        updateAuthorization()
    }

    func refresh() {
        guard CLLocationManager.locationServicesEnabled() else {
            state = .unavailable
            return
        }

        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways:
            if let lastLocation {
                publish(lastLocation, isLastKnown: true)
            } else {
                state = .locating
            }
            manager.requestLocation()
        case .denied:
            lastLocation = nil
            state = .denied
        case .restricted:
            lastLocation = nil
            state = .restricted
        @unknown default:
            state = .unavailable
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        updateAuthorization()
        if manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways {
            refresh()
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways else {
            updateAuthorization()
            return
        }
        guard let location = locations.last(where: {
            $0.horizontalAccuracy >= 0 &&
                SpotCoordinate(latitude: $0.coordinate.latitude, longitude: $0.coordinate.longitude).isValid
        }) else {
            if let lastLocation {
                publish(lastLocation, isLastKnown: true)
            } else {
                state = .unavailable
            }
            return
        }
        lastLocation = location
        publish(location, isLastKnown: Date().timeIntervalSince(location.timestamp) > 60)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways else {
            updateAuthorization()
            return
        }
        if let lastLocation {
            publish(lastLocation, isLastKnown: true)
        } else {
            state = .unavailable
        }
    }

    private func updateAuthorization() {
        guard CLLocationManager.locationServicesEnabled() else {
            state = .unavailable
            return
        }
        switch manager.authorizationStatus {
        case .notDetermined:
            state = .notDetermined
        case .denied:
            lastLocation = nil
            state = .denied
        case .restricted:
            lastLocation = nil
            state = .restricted
        case .authorizedWhenInUse, .authorizedAlways:
            if let lastLocation {
                publish(lastLocation, isLastKnown: true)
            } else {
                state = .locating
            }
        @unknown default:
            state = .unavailable
        }
    }

    private func publish(_ location: CLLocation, isLastKnown: Bool) {
        state = .usable(DeviceLocation(
            coordinate: SpotCoordinate(latitude: location.coordinate.latitude, longitude: location.coordinate.longitude),
            timestamp: location.timestamp,
            horizontalAccuracyMeters: location.horizontalAccuracy,
            isApproximate: manager.accuracyAuthorization == .reducedAccuracy,
            isLastKnown: isLastKnown
        ))
    }
}
