import MapKit
import os

@MainActor
final class MapKitDestinationSearch: DestinationSearching {
    private var activeSearches: [MKLocalSearch] = []
    private let pointsOfInterestOnly: Bool

    init(pointsOfInterestOnly: Bool = false) {
        self.pointsOfInterestOnly = pointsOfInterestOnly
    }
    // Diagnoses device-only search failures without showing extra errors; the query itself is never logged publicly.
    private static let log = Logger(subsystem: "MannerPath", category: "DestinationSearch")

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
        let searches = regions.map { makeSearch(text, in: $0, priority: .default) }
        activeSearches = searches
        defer { if activeSearches.first === searches.first { activeSearches = [] } }
        // Started together: one after another, each keystroke waited for both round trips before any candidate showed.
        let responses = searches.map { search in Task { Self.destinations(try await search.start()) } }
        var lists: [[PlaceDestination]] = []
        var lastError: (any Error)?
        for response in responses {
            do {
                lists.append(try await response.value)
            } catch {
                try Task.checkCancellation()
                Self.log.error("Destination search failed: \(error.localizedDescription, privacy: .public)")
                lastError = error
                lists.append([])
            }
        }
        try Task.checkCancellation()
        // The region is only a hint: on a device in Kanazawa the nationwide search can still answer local stations for
        // "上野駅". When no answer is named for the query, ask once more with the nationwide region required.
        if !DestinationResultMerger.containsNameMatch(for: text, in: lists.flatMap { $0 }) {
            let strict = makeSearch(text, in: Self.nationwideRegion, priority: .required)
            activeSearches.append(strict)
            do {
                let response = try await strict.start()
                lists[lists.count - 1] = Self.destinations(response) + lists[lists.count - 1]
            } catch {
                try Task.checkCancellation()
                // The earlier answers still stand; only when nothing answered does this become the shown error.
                // MapKit reports "no result" as placemarkNotFound, which is an empty answer, not a failure.
                Self.log.error("Required nationwide search failed: \(error.localizedDescription, privacy: .public)")
                if (error as? MKError)?.code != .placemarkNotFound { lastError = lastError ?? error }
            }
            try Task.checkCancellation()
        }
        if let lastError, lists.allSatisfy(\.isEmpty) { throw lastError }
        return lists.count == 2
            ? DestinationResultMerger.merge(query: text, nearby: lists[0], nationwide: lists[1], origin: origin)
            : DestinationResultMerger.merge(query: text, nearby: [], nationwide: lists[0], origin: origin)
    }

    private func makeSearch(_ text: String, in region: MKCoordinateRegion,
                                   priority: MKLocalSearchRegionPriority) -> MKLocalSearch {
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = text
        request.region = region
        request.regionPriority = priority
        if pointsOfInterestOnly { request.resultTypes = .pointOfInterest }
        return MKLocalSearch(request: request)
    }

    /// Every valid item MapKit returned (MapKit itself caps a response); the merger applies the shown limit.
    static func destinations(_ response: MKLocalSearch.Response) -> [PlaceDestination] {
        response.mapItems.compactMap { item in
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

/// Live candidates while typing. MKLocalSearch answers a bare area name ("上野") with that one area, so typing uses
/// MKLocalSearchCompleter, which proposes the concrete places (上野駅, 京成上野駅, 上野恩賜公園…) behind a fragment.
/// A tapped candidate is resolved to a coordinate with one MKLocalSearch.
@MainActor
final class MapKitDestinationCompleter: DestinationCompleting {
    /// As with the search: a nationwide region alone answered "上野" in Taito with places in Osaka, and a local region
    /// alone hides a distant named place. Both run, nearby answers first.
    private var nearby: CompletionSession?
    private var nationwide: CompletionSession?
    private var focused: CompletionSession?
    private var areaSearch: MKLocalSearch?
    private let facilitySearch: any DestinationSearching
    private var generation = 0
    private var currentCompletions: [String: MKLocalSearchCompletion] = [:]
    private var previousCompletions: [String: MKLocalSearchCompletion] = [:]
    private var currentPlaces: [String: PlaceDestination] = [:]
    private var previousPlaces: [String: PlaceDestination] = [:]
    private var facilitySuggestions: [DestinationSuggestion] = []
    /// The area the query names when resolved, else the user's surroundings; located candidates there rank first.
    private var focus: SpotCoordinate?
    /// Anchor lookups by normalized query. Typing "上野駅" and deleting back to "上野" would otherwise repeat the
    /// same nationwide lookups, which count toward MapKit's request throttle. Successful answers only.
    private var anchorCache: [String: (coordinate: SpotCoordinate?, places: [PlaceDestination])] = [:]
    private static let anchorCacheLimit = 32
    /// MKLocalSearch requests started for the current query, and when it started; logged without the query.
    private(set) var requestCount = 0
    private var startedAt = ContinuousClock.now
    private var reportedFirstConcrete = false
    private var activeResolve: MKLocalSearch?
    fileprivate static let log = Logger(subsystem: "MannerPath", category: "DestinationCompleter")

    init(facilitySearch: any DestinationSearching = MapKitDestinationSearch(pointsOfInterestOnly: true)) {
        self.facilitySearch = facilitySearch
    }

    func suggestions(for text: String, near origin: SpotCoordinate?) async throws -> [DestinationSuggestion] {
        try await suggestions(for: text, near: origin, onUpdate: { _ in })
    }

    func suggestions(for text: String, near origin: SpotCoordinate?,
                     onUpdate: @escaping @MainActor ([DestinationSuggestion]) -> Void) async throws -> [DestinationSuggestion] {
        generation += 1
        let requestGeneration = generation
        nearby?.cancel()
        nationwide?.cancel()
        focused?.cancel()
        focused = nil
        areaSearch?.cancel()
        // Debounced edits can start several requests before any replacement rows arrive. Keep the last displayed
        // lookup through those empty generations so a still-visible candidate remains selectable.
        if !currentCompletions.isEmpty || !currentPlaces.isEmpty {
            previousCompletions = currentCompletions
            previousPlaces = currentPlaces
        }
        currentCompletions = [:]
        currentPlaces = [:]
        facilitySuggestions = []
        let local: MKCoordinateRegion? = origin.flatMap { origin in
            guard origin.isValid else { return nil }
            return MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: origin.latitude, longitude: origin.longitude),
                                      latitudinalMeters: 20_000, longitudinalMeters: 20_000)
        }
        // A new delegate per query prevents an old fragment's callback being labelled as the new query.
        let nearby = CompletionSession(label: "nearby", priority: .default)
        let nationwide = CompletionSession(label: "nationwide", priority: .required)
        self.nearby = nearby
        self.nationwide = nationwide
        focus = origin?.isValid == true ? origin : nil
        requestCount = 0
        startedAt = .now
        reportedFirstConcrete = false
        let publish: @MainActor () -> Void = { [weak self, weak nearby, weak nationwide] in
            guard let self, self.generation == requestGeneration else { return }
            let completions = (nearby?.shown ?? [:]).merging(nationwide?.shown ?? [:]) { first, _ in first }
            self.currentCompletions.merge(completions) { _, latest in latest }
            self.currentCompletions.merge(self.focused?.shown ?? [:]) { _, latest in latest }
            let ranked = self.ranked(text, nearby: nearby, nationwide: nationwide)
            self.reportFirstConcrete(ranked)
            onUpdate(ranked)
        }
        nearby.onUpdate = publish
        nationwide.onUpdate = publish
        async let nearbyAnswer = Self.answer(nearby, text, local)
        async let nationwideAnswer = Self.answer(nationwide, text, MapKitDestinationSearch.nationwideRegion)
        // Device report: from Kanazawa, "上野" completed to the Tokyo 上野 area plus local 上野… rows. Those were
        // two or more rows, which used to skip this lookup, so 上野駅 and 上野恩賜公園 never appeared until the area was
        // tapped. Concrete places are now always looked up, around the area the query names.
        let anchor = await resolveAnchor(text, near: origin, generation: requestGeneration) { [weak nearby] in
            let needle = DestinationResultMerger.normalized(text)
            guard let nearby, let row = nearby.suggestions.first(where: {
                DestinationResultMerger.normalized($0.title) == needle
            }) else { return nil }
            return nearby.shown[row.id]
        }
        try Task.checkCancellation()
        guard generation == requestGeneration else { throw CancellationError() }
        // The station lookup also answers unrelated stations; only those named for the query are candidates.
        let needle = DestinationResultMerger.normalized(text)
        addFacilities(anchor.places.filter {
            DestinationResultMerger.nameTier($0.name, needle) < DestinationResultMerger.unnamedTier
        })
        if let coordinate = anchor.coordinate {
            focus = coordinate
            let focused = CompletionSession(label: "resolved-area", priority: .default)
            self.focused = focused
            focused.onUpdate = publish
            publish()
            // No points-of-interest search here: on the simulator one around 上野駅 answered only 上野駅 itself, which the
            // anchor lookup already returned, while this completer listed 上野動物園, 上野恩賜公園, 京成上野…
            _ = await Self.answer(focused, text, MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: coordinate.latitude, longitude: coordinate.longitude),
                latitudinalMeters: 20_000, longitudinalMeters: 20_000
            ))
        } else {
            await searchFacilities(text, near: origin, generation: requestGeneration, publish: publish)
        }
        let (first, second) = await (nearbyAnswer, nationwideAnswer)
        try Task.checkCancellation()
        guard generation == requestGeneration else { throw CancellationError() }
        let result = ranked(text, nearby: nearby, nationwide: nationwide)
        reportFirstConcrete(result)
        Self.log.debug("Suggestions settled requests=\(self.requestCount) anchored=\(anchor.coordinate != nil) count=\(result.count) elapsed=\(self.startedAt.duration(to: .now).description, privacy: .public)")
        if result.isEmpty {
            if case .failure(let error) = first, case .failure = second { throw error }
            if local == nil, case .failure(let error) = second { throw error }
        }
        return result
    }

    /// Area-focused completions, then located facilities, then nearby and nationwide completions; the ranker then
    /// orders by title match and by distance from `focus` where a coordinate is known.
    private func ranked(_ text: String, nearby: CompletionSession?, nationwide: CompletionSession?) -> [DestinationSuggestion] {
        let resolvedArea = (focused?.suggestions ?? []).map { suggestion in
            var suggestion = suggestion
            suggestion.inResolvedArea = true
            return suggestion
        }
        let candidates = resolvedArea + facilitySuggestions
            + (nearby?.suggestions ?? []) + (nationwide?.suggestions ?? [])
        return DestinationSuggestionRanker.rank(query: text, candidates, focus: focus)
    }

    /// Located places selectable with one tap and no further request.
    private func addFacilities(_ places: [PlaceDestination]) {
        for place in places {
            let id = Self.placeID(place)
            currentPlaces[id] = place
            facilitySuggestions.append(DestinationSuggestion(id: id, title: place.name, subtitle: place.subtitle,
                                                             coordinate: place.coordinate))
        }
    }

    /// Time to the first located (concrete) candidate: the delay the user waits before a place can be tapped
    /// without a further lookup.
    private func reportFirstConcrete(_ ranked: [DestinationSuggestion]) {
        guard !reportedFirstConcrete, ranked.contains(where: { $0.coordinate != nil }) else { return }
        reportedFirstConcrete = true
        Self.log.debug("First concrete candidate requests=\(self.requestCount) elapsed=\(self.startedAt.duration(to: .now).description, privacy: .public)")
    }

    private func searchFacilities(_ text: String, near origin: SpotCoordinate?, generation requestGeneration: Int,
                                  publish: @MainActor () -> Void) async {
        // Two or three requests: around the user, nationwide, and a strict nationwide retry when nothing is named.
        requestCount += 2
        do {
            let places = try await facilitySearch.search(text, near: origin)
            guard !Task.isCancelled, generation == requestGeneration else { return }
            addFacilities(places)
            publish()
        } catch {
            Self.log.error("Supplementary facility search failed: \((error as NSError).domain, privacy: .public) \((error as NSError).code)")
        }
    }

    /// One nationwide lookup of the station named by the query ("上野" → "上野駅"), then of the query itself
    /// ("金沢市富樫"). Its answers are returned as candidates too, so the lookup is never a wasted request.
    /// A far station is kept unless the query also names a place right around the user. "本町" typed in Kanazawa
    /// finds 本町駅 in Osaka and no Kanazawa 本町 nationwide, yet the nearby completer lists one: only that row is
    /// resolved (one request, and only when such a row exists), and it wins if it is within
    /// `DestinationAnchor.localPreferenceMeters`. 上野 in Tsubata, the nearby row for "上野", is farther and loses.
    private func resolveAnchor(_ text: String, near origin: SpotCoordinate?, generation requestGeneration: Int,
                               nearbyExactRow: @MainActor () -> MKLocalSearchCompletion?) async
        -> (coordinate: SpotCoordinate?, places: [PlaceDestination]) {
        guard text.count >= 2 else { return (nil, []) }
        // The local preference depends on where the user is; about 1 km of movement keeps the cached answer.
        let key = DestinationResultMerger.normalized(text)
            + (origin.map { String(format: "@%.2f,%.2f", $0.latitude, $0.longitude) } ?? "")
        if let cached = anchorCache[key] { return cached }
        var found: [PlaceDestination] = []
        var farAnchor: SpotCoordinate?
        for anchorQuery in text.hasSuffix("駅") ? [text] : [text + "駅", text] {
            guard !Task.isCancelled, generation == requestGeneration else { return (nil, found) }
            if farAnchor != nil { break }
            let request = MKLocalSearch.Request()
            request.naturalLanguageQuery = anchorQuery
            request.region = MapKitDestinationSearch.nationwideRegion
            request.regionPriority = .required
            if anchorQuery != text { request.resultTypes = .pointOfInterest }
            do {
                let places = try await start(MKLocalSearch(request: request))
                found += places
                if let anchor = DestinationAnchor.pick(query: anchorQuery, from: places, near: origin) {
                    if DestinationAnchor.isLocal(anchor, to: origin) { return cacheAnchor(key, (anchor, found)) }
                    farAnchor = anchor
                }
            } catch {
                // Not cached: a dropped connection must not leave the query unanchored for the rest of the session.
                Self.log.error("Area search failed: \((error as NSError).domain, privacy: .public) \((error as NSError).code)")
                return (farAnchor, found)
            }
        }
        if farAnchor != nil, let row = nearbyExactRow() {
            guard !Task.isCancelled, generation == requestGeneration else { return (nil, found) }
            do {
                let places = try await start(MKLocalSearch(request: MKLocalSearch.Request(completion: row)))
                if let local = places.first, DestinationAnchor.isLocal(local.coordinate, to: origin) {
                    return cacheAnchor(key, (local.coordinate, found + [local]))
                }
            } catch {
                Self.log.error("Nearby row lookup failed: \((error as NSError).domain, privacy: .public) \((error as NSError).code)")
                return (farAnchor, found)
            }
        }
        guard !Task.isCancelled, generation == requestGeneration else { return (nil, found) }
        return cacheAnchor(key, (farAnchor, found))
    }

    private func start(_ search: MKLocalSearch) async throws -> [PlaceDestination] {
        areaSearch = search
        requestCount += 1
        return MapKitDestinationSearch.destinations(try await search.start())
    }

    private func cacheAnchor(_ key: String, _ answer: (coordinate: SpotCoordinate?, places: [PlaceDestination]))
        -> (coordinate: SpotCoordinate?, places: [PlaceDestination]) {
        if anchorCache.count >= Self.anchorCacheLimit { anchorCache.removeAll() }
        anchorCache[key] = answer
        return answer
    }

    private static func placeID(_ place: PlaceDestination) -> String { "facility:\(place.id)" }

    private static func answer(_ session: CompletionSession, _ text: String, _ region: MKCoordinateRegion?) async
        -> Result<[DestinationSuggestion], any Error> {
        guard let region else { return .success([]) }
        do { return .success(try await session.complete(text, in: region)) } catch { return .failure(error) }
    }

    func resolve(_ suggestion: DestinationSuggestion, near origin: SpotCoordinate?) async throws -> PlaceDestination {
        if let place = currentPlaces[suggestion.id] ?? previousPlaces[suggestion.id] { return place }
        guard let completion = currentCompletions[suggestion.id] ?? previousCompletions[suggestion.id] else { throw MapKitCompletionError.stale }
        activeResolve?.cancel()
        let search = MKLocalSearch(request: MKLocalSearch.Request(completion: completion))
        activeResolve = search
        defer { if activeResolve === search { activeResolve = nil } }
        let response = try await search.start()
        try Task.checkCancellation()
        let items = response.mapItems.filter {
            SpotCoordinate(latitude: $0.placemark.coordinate.latitude, longitude: $0.placemark.coordinate.longitude).isValid
        }
        guard let item = items.first else { throw MapKitCompletionError.noPlace }
        return PlaceDestination(
            id: UUID(), name: suggestion.title, subtitle: item.placemark.title ?? suggestion.subtitle,
            coordinate: SpotCoordinate(latitude: item.placemark.coordinate.latitude,
                                       longitude: item.placemark.coordinate.longitude)
        )
    }
}

/// One MKLocalSearchCompleter behind an async call. Its delegate answers each fragment change once.
@MainActor
private final class CompletionSession: NSObject, MKLocalSearchCompleterDelegate {
    private let completer = MKLocalSearchCompleter()
    private var pending: CheckedContinuation<[DestinationSuggestion], any Error>?
    private(set) var shown: [String: MKLocalSearchCompletion] = [:]
    private(set) var suggestions: [DestinationSuggestion] = []
    var onUpdate: (@MainActor () -> Void)?
    private let label: String
    private let started = ContinuousClock.now
    private var cancelled = false
    private var timeoutTask: Task<Void, Never>?

    init(label: String, priority: MKLocalSearchRegionPriority) {
        self.label = label
        super.init()
        completer.delegate = self
        // Places only: a `.query` completion ("上野 カフェ") is another search, not a place one tap can select.
        completer.resultTypes = [.address, .pointOfInterest]
        completer.regionPriority = priority
    }

    func cancel() {
        cancelled = true
        completer.cancel()
        settleTask?.cancel()
        timeoutTask?.cancel()
        pending?.resume(throwing: CancellationError())
        pending = nil
        onUpdate = nil
    }

    func complete(_ text: String, in region: MKCoordinateRegion) async throws -> [DestinationSuggestion] {
        try Task.checkCancellation()
        guard !cancelled else { throw CancellationError() }
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                pending = continuation
                completer.region = region
                completer.queryFragment = text
                // A missing delegate callback must not leave the UI waiting forever or prevent facility fallback.
                timeoutTask = Task { [weak self] in
                    do { try await Task.sleep(for: .seconds(8)) } catch { return }
                    self?.fail(URLError(.timedOut))
                }
            }
        } onCancel: {
            Task { @MainActor [weak self] in self?.cancel() }
        }
    }

    private func finish(_ results: [MKLocalSearchCompletion]) {
        guard !cancelled else { return }
        var byID: [String: MKLocalSearchCompletion] = [:]
        suggestions = results.map { completion in
            let id = completion.title + "\n" + completion.subtitle
            byID[id] = completion
            return DestinationSuggestion(id: id, title: completion.title,
                                         subtitle: completion.subtitle.isEmpty ? nil : completion.subtitle)
        }
        // Retain candidates already visible while a later delegate update refines this same query.
        shown.merge(byID) { _, latest in latest }
        MapKitDestinationCompleter.log.debug("Completion \(self.label, privacy: .public) count=\(results.count) elapsed=\(self.started.duration(to: .now).description, privacy: .public) priority=\(self.completer.regionPriority.rawValue)")
        onUpdate?()
        // The first callback can be partial (in the simulator, "上野" first answered with only the 上野 area); later
        // ones refine it. Answer with the latest after a short quiet window, restarted by each update.
        settleTask?.cancel()
        settleTask = Task { [weak self] in
            try? await Task.sleep(for: Self.settleWindow)
            guard let self, !Task.isCancelled, !cancelled else { return }
            pending?.resume(returning: suggestions)
            pending = nil
            timeoutTask?.cancel()
        }
    }

    private static let settleWindow = Duration.milliseconds(250)
    private var settleTask: Task<Void, Never>?

    private func fail(_ error: any Error) {
        guard !cancelled else { return }
        // MapKit reports "no candidate" as placemarkNotFound: an empty answer, not a failure.
        if (error as? MKError)?.code == .placemarkNotFound { return finish([]) }
        MapKitDestinationCompleter.log.error("Completion \(self.label, privacy: .public) failed domain=\((error as NSError).domain, privacy: .public) code=\((error as NSError).code)")
        settleTask?.cancel()
        timeoutTask?.cancel()
        pending?.resume(throwing: error)
        pending = nil
    }

    nonisolated func completerDidUpdateResults(_: MKLocalSearchCompleter) {
        MainActor.assumeIsolated { finish(completer.results) }
    }

    nonisolated func completer(_: MKLocalSearchCompleter, didFailWithError error: any Error) {
        MainActor.assumeIsolated { fail(error) }
    }
}

private enum MapKitCompletionError: Error { case stale, noPlace }

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
