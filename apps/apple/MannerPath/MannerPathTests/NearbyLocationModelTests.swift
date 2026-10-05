import Foundation
import Testing
@testable import MannerPath

@MainActor
struct NearbyLocationModelTests {
    private let origin = SpotCoordinate(latitude: 35.7112, longitude: 139.77377)

    @Test func destinationLoadsOnlyItsNeighborhoodAndClearRestoresDeviceArea() async throws {
        let far = SpotCoordinate(latitude: 34.68, longitude: 135.5)
        let homeTile = try tile(at: origin)
        let farTile = try tile(at: far)
        let store = FakeTileData(cached: [homeTile.id: [spot("home", at: origin, tile: homeTile)],
                                        farTile.id: [spot("destination", at: far, tile: farTile)]])
        let model = NearbyModel(location: FakeLocationProvider(state: .usable(deviceLocation(at: origin))),
                                repository: store, refresher: store)
        #expect(await waitUntil { model.dataState == .refreshed })
        #expect(model.results.map(\.spot.id) == ["home"])
        let before = await store.refreshCount()
        model.selectDestination(PlaceDestination(id: UUID(), name: "Far", coordinate: far))
        #expect(model.results.isEmpty)
        #expect(await waitUntil { model.dataState == .refreshed })
        #expect(model.results.map(\.spot.id) == ["destination"])
        #expect(model.resultsArea?.coordinate == far)
        #expect(model.resultsLocation == nil)
        #expect(model.displayLocation?.coordinate == origin)
        #expect(Set(Array((await store.refreshedTileIDs()).dropFirst(before))) == Set(farTile.neighborhood3x3().map(\.id)))
        model.selectDestination(nil)
        #expect(await waitUntil { model.dataState == .refreshed })
        #expect(model.results.map(\.spot.id) == ["home"])
        #expect(model.resultsLocation?.coordinate == origin)
    }

    @Test func rapidDestinationsIgnoreLateResponseAndNeverPublishDestinationToCompanions() async throws {
        let first = SpotCoordinate(latitude: 34.68, longitude: 135.5)
        let second = SpotCoordinate(latitude: 35.01, longitude: 135.77)
        let homeTile = try tile(at: origin)
        let firstTile = try tile(at: first)
        let secondTile = try tile(at: second)
        let gate = RefreshGate()
        let store = FakeTileData(cached: [homeTile.id: [spot("home", at: origin, tile: homeTile)],
                                         secondTile.id: [spot("second", at: second, tile: secondTile)]],
                                 replacements: [firstTile.id: [spot("late-first", at: first, tile: firstTile)]],
                                 gate: gate, gatedTiles: Set(firstTile.neighborhood3x3().map(\.id)))
        let location = FakeLocationProvider(state: .usable(deviceLocation(at: origin)))
        let model = NearbyModel(location: location, repository: store, refresher: store)
        #expect(await waitUntil { model.dataState == .refreshed })
        var watchOrigins: [SpotCoordinate] = []
        var glanceOrigins: [SpotCoordinate] = []
        model.onCachedCorpusChange = { _, _, coordinate in watchOrigins.append(coordinate) }
        model.onCachedGlanceChange = { _, location in glanceOrigins.append(location.coordinate) }
        model.selectDestination(PlaceDestination(id: UUID(), name: "First", coordinate: first))
        #expect(await waitUntil { (await store.refreshedTileIDs()).contains(firstTile.id) })
        model.selectDestination(PlaceDestination(id: UUID(), name: "Second", coordinate: second))
        #expect(await waitUntil { model.dataState == .refreshed && model.resultsArea?.coordinate == second })
        location.send(.usable(deviceLocation(at: origin)))
        await gate.release()
        #expect(await waitUntil { (await store.cachedSpotIDs(in: firstTile.id)) == ["late-first"] })
        try await Task.sleep(for: .milliseconds(50))
        #expect(model.results.map(\.spot.id) == ["second"])
        #expect(model.resultsArea?.coordinate == second)
        #expect(watchOrigins.isEmpty)
        #expect(glanceOrigins.isEmpty)
        model.publishCachedCorpusForWatch()
        #expect(watchOrigins == [origin])
        #expect(glanceOrigins == [origin])
        location.send(.denied)
        model.publishCachedCorpusForWatch()
        #expect(watchOrigins == [origin])
        #expect(glanceOrigins == [origin])
        #expect(model.resultsArea?.coordinate == second)
    }

    @Test func destinationFailureKeepsOnlyDestinationCacheAndNotPreviousArea() async throws {
        let far = SpotCoordinate(latitude: 34.68, longitude: 135.5)
        let empty = SpotCoordinate(latitude: 40, longitude: -74)
        let homeTile = try tile(at: origin)
        let farTile = try tile(at: far)
        let emptyTile = try tile(at: empty)
        let store = FakeTileData(cached: [homeTile.id: [spot("home", at: origin, tile: homeTile)],
                                         farTile.id: [spot("saved-destination", at: far, tile: farTile)]],
                                 failing: Set((farTile.neighborhood3x3() + emptyTile.neighborhood3x3()).map(\.id)))
        let model = NearbyModel(location: FakeLocationProvider(state: .usable(deviceLocation(at: origin))),
                                repository: store, refresher: store)
        #expect(await waitUntil { model.dataState == .refreshed })
        model.selectDestination(PlaceDestination(id: UUID(), name: "Far", coordinate: far))
        #expect(await waitUntil { model.dataState == .refreshFailed })
        #expect(model.results.map(\.spot.id) == ["saved-destination"])
        model.selectDestination(PlaceDestination(id: UUID(), name: "Uncached", coordinate: empty))
        #expect(model.results.isEmpty)
        #expect(await waitUntil { model.dataState == .refreshFailed })
        #expect(model.results.isEmpty)
    }

    @Test func offlineDestinationWorksWithoutLocationPermissionAndClearWaitsForLocation() async throws {
        let destinationTile = try tile(at: origin)
        let store = FakeTileData(cached: [destinationTile.id: [spot("offline", at: origin, tile: destinationTile)]],
                                 prepareFails: true)
        let model = NearbyModel(location: FakeLocationProvider(state: .denied), repository: store, refresher: store)
        model.selectDestination(PlaceDestination(id: UUID(), name: "Saved", coordinate: origin))
        #expect(await waitUntil { model.dataState == .refreshFailed })
        #expect(model.results.map(\.spot.id) == ["offline"])
        #expect(await store.refreshCount() == 0)
        #expect(model.displayLocation == nil)
        #expect(model.resultsArea?.isDestination == true)
        model.selectDestination(nil)
        #expect(model.results.isEmpty)
        #expect(model.resultsArea == nil)
        #expect(model.dataState == .waitingForLocation)
    }

    @Test func deniedDestinationRefreshDoesNotRequestDeviceLocationOrPublishCompanionCorpus() async throws {
        let destinationTile = try tile(at: origin)
        let location = FakeLocationProvider(state: .denied)
        let store = FakeTileData(cached: [destinationTile.id: [spot("saved", at: origin, tile: destinationTile)]])
        let model = NearbyModel(location: location, repository: store, refresher: store)
        var companionPublications = 0
        model.onCachedCorpusChange = { _, _, _ in companionPublications += 1 }
        model.onCachedGlanceChange = { _, _ in companionPublications += 1 }
        model.selectDestination(PlaceDestination(id: UUID(), name: "Saved", coordinate: origin))
        #expect(await waitUntil { model.dataState == .refreshed })
        let before = await store.refreshCount()
        model.refresh()
        #expect(await waitUntil {
            let count = await store.refreshCount()
            return model.dataState == .refreshed && count == before + 9
        })
        #expect(location.refreshCount == 0)
        #expect(model.results.map(\.spot.id) == ["saved"])
        #expect(companionPublications == 0)
        model.refreshDeviceLocation()
        #expect(location.refreshCount == 1)
    }

    @Test func reportingEmptyStateInvitationRequiresAvailableReports() {
        for availability in [ReportAvailability.unknown, .unavailable, .incompatible, .attestationUnsupported] {
            #expect(NearbyEmptyStateCopy.description(for: availability) == String(localized: "Coverage varies by area. Only published places are shown."))
        }
        let limits = ReportLimits(noteMaxLength: 280, maxBodyBytes: 4096)
        #expect(NearbyEmptyStateCopy.description(for: .available(limits)) == String(localized: "If you know a smoking place here, you can add it for review."))
    }

    @Test func permissionIsRequestedOnlyByExplicitAction() async {
        let location = FakeLocationProvider(state: .notDetermined)
        let store = FakeTileData()
        let model = NearbyModel(location: location, repository: store, refresher: nil)

        model.start()
        #expect(location.refreshCount == 0)
        #expect(model.results.isEmpty)
        #expect(await store.readTileIDs().isEmpty)

        model.refresh()
        #expect(location.refreshCount == 1)
        location.send(.locating)
        model.start()
        #expect(location.refreshCount == 2)
    }

    @Test func widgetLinkCanResolveCachedSpotHiddenByFilters() async throws {
        let tile = try tile(at: origin)
        let store = FakeTileData(cached: [tile.id: [spot("saved", at: origin, tile: tile)]])
        let model = NearbyModel(location: FakeLocationProvider(state: .usable(deviceLocation(at: origin))),
                                repository: store, refresher: nil)
        #expect(await waitUntil {
            if case .cacheOnly = model.dataState { return true }
            return false
        })
        var filters = NearbyFilters()
        filters.spotTypes = [.publicSmokingRoom]
        model.setFilters(filters)
        #expect(model.result(id: "saved") == nil)
        #expect(model.cachedResult(id: "saved")?.spot.id == "saved")
        #expect(model.cachedResult(id: "removed") == nil)
    }

    @Test func cachedResultsAppearBeforeNetworkAndRefreshReranks() async throws {
        let tile = try tile(at: origin)
        let old = spot("old", at: origin, tile: tile, longitudeOffset: 0.002)
        let nearer = spot("nearer", at: origin, tile: tile, longitudeOffset: 0.0001)
        let gate = RefreshGate()
        let store = FakeTileData(
            cached: [tile.id: [old]],
            replacements: [tile.id: [old, nearer]],
            gate: gate
        )
        let model = NearbyModel(
            location: FakeLocationProvider(state: .usable(deviceLocation(at: origin))),
            repository: store,
            refresher: store
        )

        #expect(await waitUntil { await store.refreshCount() > 0 })
        #expect(model.results.map(\.spot.id) == ["old"])
        if case .refreshing = model.dataState {} else { Issue.record("Expected refreshing with cached results") }

        await gate.release()
        #expect(await waitUntil {
            if case .refreshed = model.dataState { return true }
            return false
        })
        #expect(model.results.map(\.spot.id) == ["nearer", "old"])
        #expect(Set(await store.refreshedTileIDs()) == Set(tile.neighborhood3x3().map(\.id)))
    }

    @Test func partialRefreshFailureKeepsUsableCachedResults() async throws {
        let tile = try tile(at: origin)
        let east = try #require(SlippyTile(z: tile.z, x: tile.x + 1, y: tile.y))
        let eastCoordinate = SpotCoordinate(latitude: origin.latitude, longitude: 139.8)
        let cached = spot("cached", at: origin, tile: tile)
        let replacement = spot("replacement", at: eastCoordinate, tile: east)
        let store = FakeTileData(
            cached: [tile.id: [cached], east.id: [spot("stale", at: eastCoordinate, tile: east)]],
            replacements: [east.id: [replacement]],
            failing: [tile.id]
        )
        let model = NearbyModel(
            location: FakeLocationProvider(state: .usable(deviceLocation(at: origin))),
            repository: store,
            refresher: store
        )

        #expect(await waitUntil {
            if case .refreshFailed = model.dataState { return true }
            return false
        })
        #expect(Set(model.results.map(\.spot.id)) == Set(["cached", "replacement"]))
        #expect(Set(await store.refreshedTileIDs()) == Set(tile.neighborhood3x3().map(\.id)))
    }

    @Test func authoritativeEmptyTileRemovesItsStaleResult() async throws {
        let tile = try tile(at: origin)
        let store = FakeTileData(
            cached: [tile.id: [spot("stale", at: origin, tile: tile)]],
            replacements: [tile.id: []]
        )
        let model = NearbyModel(
            location: FakeLocationProvider(state: .usable(deviceLocation(at: origin))),
            repository: store,
            refresher: store
        )

        #expect(await waitUntil {
            if case .refreshed = model.dataState { return true }
            return false
        })
        #expect(model.results.isEmpty)
    }

    @Test func duplicateSpotIDsAcrossCacheReadsAreRankedOnce() async throws {
        let tile = try tile(at: origin)
        let east = try #require(SlippyTile(z: tile.z, x: tile.x + 1, y: tile.y))
        let duplicate = spot("same-id", at: origin, tile: tile)
        let store = FakeTileData(cached: [tile.id: [duplicate], east.id: [duplicate]])
        let model = NearbyModel(
            location: FakeLocationProvider(state: .usable(deviceLocation(at: origin))),
            repository: store,
            refresher: nil
        )

        #expect(await waitUntil {
            if case .cacheOnly = model.dataState { return true }
            return false
        })
        #expect(model.results.map(\.spot.id) == ["same-id"])
    }

    @Test func offlineCachePreservesUnknownsAttributionDistanceAndBearing() async throws {
        let tile = try tile(at: origin)
        let unknown = spot("unknown", at: origin, tile: tile, longitudeOffset: 0.001, type: .unknown)
        let unsupported = spot("unsupported", at: origin, tile: tile, type: .unsupported)
        let store = FakeTileData(cached: [tile.id: [unknown, unsupported]])
        let model = NearbyModel(
            location: FakeLocationProvider(state: .usable(deviceLocation(at: origin))),
            repository: store,
            refresher: nil
        )

        #expect(await waitUntil {
            if case .cacheOnly = model.dataState { return true }
            return false
        })
        let result = try #require(model.results.first)
        #expect(model.results.count == 1)
        #expect(result.spot.spotType == .unknown)
        #expect(result.spot.supportsHeated == .unknown)
        #expect(result.spot.verification.sourceDisplayNames == ["Approved source"])
        #expect(result.distanceMeters > 80)
        #expect(result.distanceMeters < 100)
        #expect(abs(result.bearingDegrees - 90) < 0.01)
        #expect(Set(await store.readTileIDs()) == Set(tile.neighborhood3x3().map(\.id)))
        #expect(await store.refreshedTileIDs().isEmpty)
    }

    @Test func offlineSourcesAreCompleteAndDetailResolvesFromTheSameRankedResults() async throws {
        let tile = try tile(at: origin)
        let east = try #require(SlippyTile(z: tile.z, x: tile.x + 1, y: tile.y))
        let first = spot("first", at: origin, tile: tile, longitudeOffset: 0.001)
        let second = spot("second", at: origin, tile: east, longitudeOffset: 0.002)
        let wardText = "台東区 CC-BY表示4.0国際 元データ https://example.org/data.csv"
        let ward = SpotSource(id: "ward", displayName: "Ward", licenseName: "CC BY 4.0",
                              licenseURL: "https://example.org/license", attributionText: wardText)
        let revisedWard = SpotSource(id: "ward", displayName: "Ward", licenseName: "CC BY 4.0",
                                     licenseURL: "https://example.org/license", attributionText: "Revised attribution wording")
        let station = SpotSource(id: "station", displayName: "Station", licenseName: nil,
                                 licenseURL: nil, attributionText: "Station source text, unchanged.")
        let store = FakeTileData(
            cached: [tile.id: [first], east.id: [second]],
            sources: [tile.id: [ward], east.id: [revisedWard, station]]
        )
        let model = NearbyModel(
            location: FakeLocationProvider(state: .usable(deviceLocation(at: origin))),
            repository: store,
            refresher: nil
        )

        #expect(await waitUntil {
            if case .cacheOnly = model.dataState { return true }
            return false
        })
        #expect(model.results.map(\.spot.id) == ["first", "second"])
        #expect(model.result(id: "second")?.spot.id == model.results[1].spot.id)
        #expect(model.result(id: "missing") == nil)
        #expect(model.sources.map(\.id) == ["station", "ward", "ward"])
        #expect(Set(model.sources.filter { $0.id == "ward" }.compactMap(\.attributionText)) ==
                Set([wardText, "Revised attribution wording"]))
        #expect(model.sources.first(where: { $0.id == "station" })?.attributionText == "Station source text, unchanged.")
        #expect(await store.refreshedTileIDs().isEmpty)
    }

    @Test func locationChangeReplacesActiveTileNeighborhood() async throws {
        let second = SpotCoordinate(latitude: 35.5, longitude: 139.2)
        let firstTile = try tile(at: origin)
        let secondTile = try tile(at: second)
        #expect(Set(firstTile.neighborhood3x3()).isDisjoint(with: Set(secondTile.neighborhood3x3())))
        let store = FakeTileData(cached: [
            firstTile.id: [spot("first", at: origin, tile: firstTile)],
            secondTile.id: [spot("second", at: second, tile: secondTile)]
        ])
        let location = FakeLocationProvider(state: .usable(deviceLocation(at: origin)))
        let model = NearbyModel(location: location, repository: store, refresher: nil)
        #expect(await waitUntil { model.results.map(\.spot.id) == ["first"] })

        location.send(.usable(deviceLocation(at: second)))
        #expect(await waitUntil { model.results.map(\.spot.id) == ["second"] })
        #expect(Set(await store.readTileIDs()) == Set(
            firstTile.neighborhood3x3().map(\.id) + secondTile.neighborhood3x3().map(\.id)
        ))
    }

    @Test func sameNeighborhoodLocationRefreshKeepsDetailAvailableWhileReadingCache() async throws {
        let tile = try tile(at: origin)
        let location = FakeLocationProvider(state: .usable(deviceLocation(at: origin)))
        let model = NearbyModel(
            location: location,
            repository: FakeTileData(cached: [tile.id: [spot("cached", at: origin, tile: tile)]]),
            refresher: nil
        )
        #expect(await waitUntil { model.result(id: "cached") != nil })

        location.send(.locating)
        #expect(model.displayLocation != nil)
        #expect(model.result(id: "cached") != nil)
        let movedCoordinate = SpotCoordinate(latitude: origin.latitude, longitude: origin.longitude + 0.0001)
        let moved = deviceLocation(at: movedCoordinate)
        location.send(.usable(moved))
        #expect(model.result(id: "cached") != nil)
        #expect(model.resultsLocation?.coordinate == origin)
        #expect(model.displayLocation?.coordinate == movedCoordinate)
        #expect(await waitUntil {
            if case .cacheOnly = model.dataState {
                return model.resultsLocation?.coordinate == movedCoordinate
            }
            return false
        })
        #expect(model.result(id: "cached") != nil)
        #expect((model.result(id: "cached")?.distanceMeters ?? 0) > 0)
    }

    @Test func lateOldNeighborhoodRefreshCannotReplaceNewLocationResults() async throws {
        let second = SpotCoordinate(latitude: 35.5, longitude: 139.2)
        let firstTile = try tile(at: origin)
        let secondTile = try tile(at: second)
        let gate = RefreshGate()
        let store = FakeTileData(
            cached: [
                firstTile.id: [spot("first", at: origin, tile: firstTile)],
                secondTile.id: [spot("second", at: second, tile: secondTile)]
            ],
            replacements: [firstTile.id: [spot("late-old", at: origin, tile: firstTile)]],
            gate: gate,
            gatedTiles: Set(firstTile.neighborhood3x3().map(\.id))
        )
        let location = FakeLocationProvider(state: .usable(deviceLocation(at: origin)))
        let model = NearbyModel(location: location, repository: store, refresher: store)
        #expect(await waitUntil { await store.refreshCount() > 0 })
        #expect(model.results.map(\.spot.id) == ["first"])

        location.send(.usable(deviceLocation(at: second)))
        #expect(await waitUntil {
            if case .refreshed = model.dataState {
                return model.results.map(\.spot.id) == ["second"]
            }
            return false
        })
        await gate.release()
        #expect(await waitUntil { await store.cachedSpotIDs(in: firstTile.id) == ["late-old"] })
        #expect(model.results.map(\.spot.id) == ["second"])
    }

    @Test func unavailableLocationClearsResultsAndMissingRepositoryReportsUnavailable() async throws {
        let tile = try tile(at: origin)
        let location = FakeLocationProvider(state: .usable(deviceLocation(at: origin)))
        let store = FakeTileData(cached: [tile.id: [spot("cached", at: origin, tile: tile)]])
        let model = NearbyModel(location: location, repository: store, refresher: nil)
        #expect(await waitUntil { model.results.count == 1 })

        location.send(.denied)
        #expect(model.results.isEmpty)
        if case .denied = model.locationState {} else { Issue.record("Expected denied location") }
        location.send(.unavailable)
        #expect(model.results.isEmpty)
        if case .unavailable = model.locationState {} else { Issue.record("Expected unavailable location") }

        let noStore = NearbyModel(
            location: FakeLocationProvider(state: .usable(deviceLocation(at: origin))),
            repository: nil,
            refresher: nil
        )
        #expect(await waitUntil {
            if case .cacheUnavailable = noStore.dataState { return true }
            return false
        })
    }

    @Test func usableLocationRetainsAccuracyFlagsAndReranksWithinOneNeighborhood() async throws {
        let tile = try tile(at: origin)
        let first = spot("first", at: origin, tile: tile)
        let second = spot("second", at: origin, tile: tile, longitudeOffset: 0.001)
        let location = FakeLocationProvider(state: .usable(deviceLocation(at: origin)))
        let model = NearbyModel(
            location: location,
            repository: FakeTileData(cached: [tile.id: [first, second]]),
            refresher: nil
        )
        #expect(await waitUntil { model.results.map(\.spot.id) == ["first", "second"] })

        let moved = DeviceLocation(
            coordinate: SpotCoordinate(latitude: origin.latitude, longitude: origin.longitude + 0.001),
            timestamp: Date(timeIntervalSince1970: 1_789_920_001),
            horizontalAccuracyMeters: 500,
            isApproximate: true,
            isLastKnown: true
        )
        location.send(.usable(moved))
        #expect(await waitUntil { model.results.map(\.spot.id) == ["second", "first"] })
        guard case .usable(let observed) = model.locationState else {
            Issue.record("Expected usable location")
            return
        }
        #expect(observed.isApproximate)
        #expect(observed.isLastKnown)
        #expect(observed.timestamp == moved.timestamp)
    }

    @Test func refreshBoundaryReceivesOnlyCurrentNeighborhoodTiles() async throws {
        let tile = try tile(at: origin)
        let store = FakeTileData()
        let model = NearbyModel(
            location: FakeLocationProvider(state: .usable(deviceLocation(at: origin))),
            repository: store,
            refresher: store
        )

        #expect(await waitUntil {
            if case .refreshed = model.dataState { return true }
            return false
        })
        let sent = await store.refreshedTileIDs()
        #expect(Set(sent) == Set(tile.neighborhood3x3().map(\.id)))
        #expect(sent.count == tile.neighborhood3x3().count)
    }

    @Test func serverZoomFromConfigDrivesWhichTilesAreRefreshed() async throws {
        let store = FakeTileData(serverZoom: 15)
        let model = NearbyModel(
            location: FakeLocationProvider(state: .usable(deviceLocation(at: origin))),
            repository: store,
            refresher: store
        )
        #expect(await waitUntil {
            if case .refreshed = model.dataState { return true }
            return false
        })
        let z15 = try SlippyTile.forCoordinate(latitude: origin.latitude, longitude: origin.longitude, zoom: 15)
        #expect(Set(await store.refreshedTileIDs()) == Set(z15.neighborhood3x3().map(\.id)))
        #expect(await store.readTileIDs().contains(z15.id), "the cache is re-read at the server's zoom")
    }

    @Test func cachedNamespaceZoomIsReadOfflineAndUnsupportedConfigFailsClosed() async throws {
        let z16 = try SlippyTile.forCoordinate(latitude: origin.latitude, longitude: origin.longitude, zoom: 16)
        let store = FakeTileData(cached: [z16.id: [spot("saved", at: origin, tile: z16)]], cachedZoom: 16, prepareFails: true)
        let model = NearbyModel(
            location: FakeLocationProvider(state: .usable(deviceLocation(at: origin))),
            repository: store,
            refresher: store
        )
        #expect(await waitUntil {
            if case .refreshFailed = model.dataState { return true }
            return false
        })
        #expect(model.results.map(\.spot.id) == ["saved"], "cached spots of the cache's own zoom stay visible")
        #expect(await store.refreshCount() == 0, "no tile is synced without a supported config")
    }

    private func tile(at coordinate: SpotCoordinate) throws -> SlippyTile {
        try SlippyTile.forCoordinate(
            latitude: coordinate.latitude, longitude: coordinate.longitude, zoom: SlippyTile.defaultDataZoom
        )
    }

    private func deviceLocation(at coordinate: SpotCoordinate) -> DeviceLocation {
        DeviceLocation(
            coordinate: coordinate,
            timestamp: Date(timeIntervalSince1970: 1_789_920_000),
            horizontalAccuracyMeters: 20,
            isApproximate: false,
            isLastKnown: false
        )
    }

    private func spot(
        _ id: String,
        at coordinate: SpotCoordinate,
        tile: SlippyTile,
        longitudeOffset: Double = 0,
        type: SpotType = .ashtray
    ) -> Spot {
        Spot(
            id: id, mergedInto: nil, name: id,
            latitude: coordinate.latitude, longitude: coordinate.longitude + longitudeOffset,
            tileId: tile.id, spotType: type, hostType: nil,
            accessType: .unknown, environment: .unknown,
            supportsPaper: .unknown, supportsHeated: .unknown,
            openingHours: nil, feeType: nil, floor: nil, entranceNote: nil,
            lifecycle: .active,
            verification: SpotVerification(
                acceptedExistenceEvidence: .yes,
                evidenceQuality: "officialListing",
                sourceDisplayNames: ["Approved source"]
            ),
            lastVerifiedAt: nil, createdAt: nil, updatedAt: nil
        )
    }

    private func waitUntil(_ condition: @escaping @MainActor () async -> Bool) async -> Bool {
        for _ in 0..<400 {
            if await condition() { return true }
            try? await Task.sleep(for: .milliseconds(5))
        }
        return false
    }
}

@MainActor
private final class FakeLocationProvider: LocationProviding {
    private(set) var state: NearbyLocationState
    var onStateChange: (@MainActor (NearbyLocationState) -> Void)?
    private(set) var refreshCount = 0

    init(state: NearbyLocationState) { self.state = state }
    func refresh() { refreshCount += 1 }
    func send(_ state: NearbyLocationState) {
        self.state = state
        onStateChange?(state)
    }
}

private actor RefreshGate {
    private var isReleased = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func wait() async {
        if isReleased { return }
        await withCheckedContinuation { waiters.append($0) }
    }

    func release() {
        isReleased = true
        for waiter in waiters { waiter.resume() }
        waiters.removeAll()
    }
}

private enum FakeRefreshError: Error { case failed }

private actor FakeTileData: CachedSpotRepository, NearbyTileRefreshing {
    private var cached: [String: [Spot]]
    private var sourcesByTile: [String: [SpotSource]]
    private let replacements: [String: [Spot]]
    private let failing: Set<String>
    private let gate: RefreshGate?
    private let gatedTiles: Set<String>?
    private var reads: [String] = []
    private var refreshes: [String] = []
    private let serverZoom: Int?
    private let cachedZoom: Int
    private let prepareFails: Bool

    init(
        cached: [String: [Spot]] = [:],
        sources: [String: [SpotSource]] = [:],
        replacements: [String: [Spot]] = [:],
        failing: Set<String> = [],
        gate: RefreshGate? = nil,
        gatedTiles: Set<String>? = nil,
        serverZoom: Int? = nil,
        cachedZoom: Int = SlippyTile.defaultDataZoom,
        prepareFails: Bool = false
    ) {
        self.serverZoom = serverZoom
        self.cachedZoom = cachedZoom
        self.prepareFails = prepareFails
        self.cached = cached
        sourcesByTile = sources
        self.replacements = replacements
        self.failing = failing
        self.gate = gate
        self.gatedTiles = gatedTiles
    }

    func spots(inTile tileID: String) async throws -> [Spot] {
        reads.append(tileID)
        return cached[tileID] ?? []
    }

    func sources(inTile tileID: String) async throws -> [SpotSource] {
        sourcesByTile[tileID] ?? []
    }

    func dataZoom() async throws -> Int { cachedZoom }

    func prepare() async throws -> Int {
        if prepareFails { throw TileSyncError.unsupportedConfig }
        return serverZoom ?? cachedZoom
    }

    func refresh(_ tile: SlippyTile) async throws {
        refreshes.append(tile.id)
        if gatedTiles == nil || gatedTiles?.contains(tile.id) == true {
            await gate?.wait()
        }
        if failing.contains(tile.id) { throw FakeRefreshError.failed }
        if let replacement = replacements[tile.id] { cached[tile.id] = replacement }
    }

    func readTileIDs() -> [String] { reads }
    func refreshedTileIDs() -> [String] { refreshes }
    func refreshCount() -> Int { refreshes.count }
    func cachedSpotIDs(in tileID: String) -> [String] { (cached[tileID] ?? []).map(\.id) }
}
