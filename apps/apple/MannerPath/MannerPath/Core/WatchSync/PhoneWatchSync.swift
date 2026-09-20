import Foundation
import WatchConnectivity

enum WatchSnapshotBuilder {
    static func build(spots: [Spot], sources: [SpotSource], near origin: SpotCoordinate,
                      at now: Date = Date()) -> WatchSnapshot {
        // Selection is unfiltered by preferences. The Watch may change its quick filters offline.
        let candidates = NearbySearch.rank(spots, from: origin, at: now).prefix(500).map(\.spot)
        let referenced = Set(candidates.flatMap { $0.verification.sources?.map(\.id) ?? [] })
        return WatchSnapshot(
            schemaVersion: WatchSnapshot.schemaVersion, generatedAt: now, snapshotID: UUID(),
            spots: candidates.map { spot in
                WatchSpot(
                    id: spot.id, name: spot.name, latitude: spot.latitude, longitude: spot.longitude,
                    spotType: spot.spotType.rawValue, accessType: spot.accessType.rawValue,
                    supportsPaper: spot.supportsPaper.rawValue,
                    supportsHeated: spot.supportsHeated.rawValue, lifecycle: spot.lifecycle.rawValue,
                    evidenceQuality: spot.verification.evidenceQuality,
                    evidenceQualityVersion: spot.verification.evidenceQualityVersion,
                    lastVerifiedAt: spot.lastVerifiedAt,
                    openingHours: spot.openingHours.map {
                        WatchHours(status: $0.status.rawValue, kind: $0.parsed?.kind.rawValue,
                                   version: $0.parsed?.version, opens: $0.parsed?.opens,
                                   closes: $0.parsed?.closes, timeZone: $0.timeZone)
                    }, sourceIDs: spot.verification.sources?.map(\.id) ?? []
                )
            },
            sources: sources.filter { referenced.contains($0.id) }.map {
                WatchSource(id: $0.id, displayName: $0.displayName, licenseName: $0.licenseName,
                            licenseURL: $0.licenseURL, attributionText: $0.attributionText)
            }
        )
    }
}

enum WatchPreferenceStore {
    private static let key = "watch-preferences-v1"

    static func load() -> WatchPreferences {
        guard let data = UserDefaults.standard.data(forKey: key),
              let preferences = try? WatchCodec.preferences(data) else { return .defaults() }
        return preferences
    }

    static func filters(from value: WatchPreferences) -> NearbyFilters {
        var filters = NearbyFilters()
        filters.tobaccoType = value.tobaccoType == "paper" ? .paper :
            value.tobaccoType == "heated" ? .heated : nil
        filters.requireConfirmedTobaccoSupport = value.requireConfirmedTobaccoSupport
        filters.publicAccessOnly = value.publicAccessOnly
        filters.requireConfirmedPublicAccess = value.requireConfirmedPublicAccess
        filters.spotTypes = value.spotTypes.map { Set($0.compactMap(SpotType.init(rawValue:))) }
        filters.openNowOnly = value.openNowOnly
        filters.officialEvidenceOnly = value.officialEvidenceOnly
        filters.verifiedWithin = value.verifiedWithinDays.map { Double($0) * 86_400 }
        return filters
    }

    static func save(_ filters: NearbyFilters, at now: Date = Date()) -> WatchPreferences {
        let value = WatchPreferences(
            schemaVersion: 1, generatedAt: now,
            tobaccoType: filters.tobaccoType.map { $0 == .paper ? "paper" : "heated" },
            requireConfirmedTobaccoSupport: filters.requireConfirmedTobaccoSupport,
            publicAccessOnly: filters.publicAccessOnly,
            requireConfirmedPublicAccess: filters.requireConfirmedPublicAccess,
            spotTypes: filters.spotTypes.map { $0.map(\.rawValue).sorted() },
            openNowOnly: filters.openNowOnly, officialEvidenceOnly: filters.officialEvidenceOnly,
            verifiedWithinDays: filters.verifiedWithin.map { Int($0 / 86_400) }
        )
        if let data = try? WatchCodec.encode(value) { UserDefaults.standard.set(data, forKey: key) }
        return value
    }
}

@MainActor
final class PhoneWatchSync: NSObject, WCSessionDelegate {
    static let shared = PhoneWatchSync()
    private var snapshotData: Data?
    private var preferenceData: Data?

    private override init() {
        super.init()
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    func publish(snapshot: WatchSnapshot) {
        guard (try? snapshot.validated()) != nil else { return }
        snapshotData = try? WatchCodec.encode(snapshot)
        send()
    }

    func publish(preferences: WatchPreferences) {
        guard (try? preferences.validated()) != nil else { return }
        preferenceData = try? WatchCodec.encode(preferences)
        send()
    }

    private func send() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else { return }
        // WC keeps the last application context across iPhone process launches.
        // Preserve its snapshot when a preference update arrives before cache reload.
        let payload = Self.updatedContext(previous: session.applicationContext,
                                          snapshotData: snapshotData, preferenceData: preferenceData)
        guard !payload.isEmpty else { return }
        try? session.updateApplicationContext(payload)
        if session.isReachable { session.sendMessage(payload, replyHandler: nil, errorHandler: nil) }
    }

    static func updatedContext(previous: [String: Any], snapshotData: Data?,
                               preferenceData: Data?) -> [String: Any] {
        var payload = previous
        if let snapshotData { payload["snapshotV1"] = snapshotData }
        if let preferenceData { payload["preferencesV1"] = preferenceData }
        return payload
    }

    nonisolated func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState,
                             error: Error?) {
        Task { @MainActor in self.send() }
    }

    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}
    nonisolated func sessionDidDeactivate(_ session: WCSession) {
        Task { @MainActor in WCSession.default.activate() }
    }

    nonisolated func sessionWatchStateDidChange(_ session: WCSession) {
        Task { @MainActor in self.send() }
    }
}
