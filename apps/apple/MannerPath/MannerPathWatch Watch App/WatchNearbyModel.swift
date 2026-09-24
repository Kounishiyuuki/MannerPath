import CoreLocation
import Foundation
import Observation
import WidgetKit
import WatchConnectivity

@Observable
@MainActor
final class WatchNearbyModel: NSObject, CLLocationManagerDelegate, WCSessionDelegate {
    private let locationManager = CLLocationManager()
    private let store: WatchStore?
    private(set) var snapshot: WatchSnapshot?
    private(set) var preferences: WatchPreferences = .defaults()
    private(set) var latitude: Double?
    private(set) var longitude: Double?
    private(set) var accuracyMeters: Double?
    private(set) var locationUnavailable = false
    private(set) var locationAuthorizationUndetermined = false
    private(set) var now = Date()

    var results: [WatchRankedSpot] {
        guard let snapshot else { return [] }
        return WatchRanking.topThree(snapshot, latitude: latitude, longitude: longitude,
                                     preferences: preferences, at: now)
    }

    var snapshotIsOld: Bool {
        guard let generatedAt = snapshot?.generatedAt else { return false }
        return generatedAt > now || now.timeIntervalSince(generatedAt) > 3_600
    }

    override convenience init() {
        self.init(store: try? WatchStore.applicationSupport(), activateConnectivity: true)
    }

    init(store: WatchStore?, activateConnectivity: Bool) {
        self.store = store
        super.init()
        snapshot = store?.snapshot()
        preferences = store?.preferences() ?? .defaults()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationAuthorizationUndetermined = locationManager.authorizationStatus == .notDetermined
        if activateConnectivity && WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    func refreshLocation(requestAuthorization: Bool = true) {
        now = Date()
        switch locationManager.authorizationStatus {
        case .notDetermined:
            locationAuthorizationUndetermined = true
            if requestAuthorization { locationManager.requestWhenInUseAuthorization() }
        case .authorizedAlways, .authorizedWhenInUse:
            locationUnavailable = false
            clearLocation()
            locationManager.requestLocation()
        default:
            clearLocation()
            locationUnavailable = true
        }
    }

    func refreshClock() { now = Date() }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        locationAuthorizationUndetermined = manager.authorizationStatus == .notDetermined
        if manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways {
            locationUnavailable = false
            manager.requestLocation()
        } else if manager.authorizationStatus != .notDetermined {
            clearLocation()
            locationUnavailable = true
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last, location.horizontalAccuracy >= 0,
              (-5...60).contains(Date().timeIntervalSince(location.timestamp)) else {
            clearLocation()
            locationUnavailable = true
            return
        }
        latitude = location.coordinate.latitude
        longitude = location.coordinate.longitude
        accuracyMeters = location.horizontalAccuracy
        locationUnavailable = false
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        clearLocation()
        locationUnavailable = true
    }

    private func clearLocation() {
        latitude = nil
        longitude = nil
        accuracyMeters = nil
    }

    func receive(snapshotData: Data?, preferenceData: Data?) {
        if let data = snapshotData,
           let accepted = try? store?.acceptSnapshot(data) {
            snapshot = accepted
            WidgetCenter.shared.reloadTimelines(ofKind: "WatchNearby")
        }
        if let data = preferenceData,
           let accepted = try? store?.acceptPreferences(data) { preferences = accepted }
    }

    func setTobacco(_ value: String?) {
        edit {
            $0.tobaccoType = value
            if value == nil { $0.requireConfirmedTobaccoSupport = false }
        }
    }
    func setConfirmedTobacco(_ value: Bool) { edit { $0.requireConfirmedTobaccoSupport = value } }
    func setPublicOnly(_ value: Bool) {
        edit {
            $0.publicAccessOnly = value
            if !value { $0.requireConfirmedPublicAccess = false }
        }
    }
    func setConfirmedPublic(_ value: Bool) { edit { $0.requireConfirmedPublicAccess = value } }
    func setVerifiedDays(_ value: Int?) { edit { $0.verifiedWithinDays = value } }
    func setSpotType(_ value: String?) { edit { $0.spotTypes = value.map { [$0] } } }
    func setOpenNow(_ value: Bool) { edit { $0.openNowOnly = value } }
    func setOfficialOnly(_ value: Bool) { edit { $0.officialEvidenceOnly = value } }
    func clearFilters() { preferences = .defaults(at: Date()); try? store?.saveLocalPreferences(preferences) }

    private func edit(_ change: (inout EditablePreferences) -> Void) {
        var editable = EditablePreferences(preferences)
        change(&editable)
        preferences = editable.value(at: Date())
        try? store?.saveLocalPreferences(preferences)
    }

    nonisolated func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState,
                             error: Error?) {
        if state == .activated {
            let context = session.receivedApplicationContext
            let snapshot = context["snapshotV1"] as? Data
            let preferences = context["preferencesV1"] as? Data
            Task { @MainActor in self.receive(snapshotData: snapshot, preferenceData: preferences) }
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) {
        let snapshot = context["snapshotV1"] as? Data
        let preferences = context["preferencesV1"] as? Data
        Task { @MainActor in self.receive(snapshotData: snapshot, preferenceData: preferences) }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        let snapshot = message["snapshotV1"] as? Data
        let preferences = message["preferencesV1"] as? Data
        Task { @MainActor in self.receive(snapshotData: snapshot, preferenceData: preferences) }
    }
}

private struct EditablePreferences {
    var tobaccoType: String?
    var requireConfirmedTobaccoSupport: Bool
    var publicAccessOnly: Bool
    var requireConfirmedPublicAccess: Bool
    var verifiedWithinDays: Int?
    var spotTypes: [String]?
    var openNowOnly: Bool
    var officialEvidenceOnly: Bool
    private let base: WatchPreferences

    init(_ base: WatchPreferences) {
        self.base = base
        tobaccoType = base.tobaccoType
        requireConfirmedTobaccoSupport = base.requireConfirmedTobaccoSupport
        publicAccessOnly = base.publicAccessOnly
        requireConfirmedPublicAccess = base.requireConfirmedPublicAccess
        verifiedWithinDays = base.verifiedWithinDays
        spotTypes = base.spotTypes
        openNowOnly = base.openNowOnly
        officialEvidenceOnly = base.officialEvidenceOnly
    }

    func value(at date: Date) -> WatchPreferences {
        WatchPreferences(schemaVersion: 1, generatedAt: date, tobaccoType: tobaccoType,
                         requireConfirmedTobaccoSupport: requireConfirmedTobaccoSupport,
                         publicAccessOnly: publicAccessOnly,
                         requireConfirmedPublicAccess: requireConfirmedPublicAccess,
                         spotTypes: spotTypes, openNowOnly: openNowOnly,
                         officialEvidenceOnly: officialEvidenceOnly,
                         verifiedWithinDays: verifiedWithinDays)
    }
}
