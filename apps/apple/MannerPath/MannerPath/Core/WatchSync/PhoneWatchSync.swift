import Foundation
import WatchConnectivity

enum WatchSnapshotBuilder {
    static func build(spots: [Spot], sources: [SpotSource], near origin: SpotCoordinate,
                      at now: Date = Date()) -> WatchSnapshot {
        // Selection is unfiltered by preferences. The Watch may change its quick filters offline.
        let candidates = NearbySearch.rank(spots, from: origin, at: now).prefix(500).map(\.spot)
        let allSources = Set(sources + candidates.flatMap { $0.verification.sources ?? [] })
            .filter { !$0.id.isEmpty }
        let referenced = Set(candidates.flatMap { $0.verification.sources?.map(\.id) ?? [] })
        return WatchSnapshot(
            schemaVersion: WatchSnapshot.schemaVersion, revision: 1,
            generatedAt: now, snapshotID: UUID(),
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
                    }, sourceIDs: Array(Set(spot.verification.sources?.map(\.id) ?? [])
                        .intersection(Set(allSources.map(\.id)))).sorted()
                )
            },
            sources: allSources.filter { referenced.contains($0.id) }.sorted {
                if $0.id != $1.id { return $0.id < $1.id }
                if $0.displayName != $1.displayName { return $0.displayName < $1.displayName }
                if $0.licenseName != $1.licenseName { return optionalLess($0.licenseName, $1.licenseName) }
                if $0.licenseURL != $1.licenseURL { return optionalLess($0.licenseURL, $1.licenseURL) }
                return optionalLess($0.attributionText, $1.attributionText)
            }.map {
                WatchSource(id: $0.id, displayName: $0.displayName, licenseName: $0.licenseName,
                            licenseURL: $0.licenseURL, attributionText: $0.attributionText)
            }
        )
    }

    private static func optionalLess(_ lhs: String?, _ rhs: String?) -> Bool {
        switch (lhs, rhs) {
        case (nil, .some): true
        case (.some, nil): false
        case let (.some(left), .some(right)): left < right
        case (nil, nil): false
        }
    }
}

// The last produced payload is also the revision journal. Saving the entire compact
// payload keeps both content identity and the counter across iPhone process restarts.
nonisolated struct PhoneWatchSnapshotStore {
    let directory: URL

    static func applicationSupport() throws -> Self {
        Self(directory: try FileManager.default.url(for: .applicationSupportDirectory,
                                                     in: .userDomainMask, appropriateFor: nil, create: true))
    }

    private var url: URL { directory.appendingPathComponent("outgoing-watch-v1.json") }

    func snapshot() -> WatchSnapshot? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? WatchCodec.snapshot(data)
    }

    func prepare(_ candidate: WatchSnapshot, recovered: WatchSnapshot? = nil) throws -> WatchSnapshot {
        let local = snapshot()
        let previous = if let recovered, recovered.revision > (local?.revision ?? 0) {
            recovered
        } else { local }
        if let previous, previous.revision > (local?.revision ?? 0) {
            try WatchCodec.encode(previous).write(to: url, options: .atomic)
        }
        if let previous, previous.spots == candidate.spots && previous.sources == candidate.sources {
            return previous
        }
        guard (previous?.revision ?? 0) < UInt64.max else { throw WatchPayloadError.invalid }
        let next = WatchSnapshot(schemaVersion: WatchSnapshot.schemaVersion,
                                 revision: (previous?.revision ?? 0) + 1,
                                 generatedAt: candidate.generatedAt, snapshotID: candidate.snapshotID,
                                 spots: candidate.spots, sources: candidate.sources)
        _ = try next.validated()
        try WatchCodec.encode(next).write(to: url, options: .atomic)
        return next
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
    private let producerStore = try? PhoneWatchSnapshotStore.applicationSupport()
    private var snapshotData: Data?
    private var preferenceData: Data?

    private override init() {
        super.init()
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    func publish(spots: [Spot], sources: [SpotSource], near origin: SpotCoordinate) {
        guard let producerStore else { return }
        let candidate = WatchSnapshotBuilder.build(spots: spots, sources: sources, near: origin)
        let recovered: WatchSnapshot? = if WCSession.isSupported(),
            let data = WCSession.default.applicationContext["snapshotV1"] as? Data {
            try? WatchCodec.snapshot(data)
        } else { nil }
        guard let snapshot = try? producerStore.prepare(candidate, recovered: recovered) else { return }
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
