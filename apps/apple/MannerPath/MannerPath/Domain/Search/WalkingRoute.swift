import Foundation

struct PlaceDestination: Identifiable, Equatable, Sendable {
    let id: UUID
    let name: String
    let subtitle: String?
    let coordinate: SpotCoordinate

    init(id: UUID, name: String, subtitle: String? = nil, coordinate: SpotCoordinate) {
        self.id = id
        self.name = name
        self.subtitle = subtitle
        self.coordinate = coordinate
    }
}

struct WalkingRoute: Sendable {
    let travelTime: TimeInterval
    let distanceMeters: Double
    let geometry: [SpotCoordinate]
}

@MainActor
protocol DestinationSearching {
    func search(_ text: String, near origin: SpotCoordinate?) async throws -> [PlaceDestination]
}

/// An ephemeral Apple Maps candidate. Completion candidates resolve on selection; supplementary facility searches
/// can already know the coordinate. Neither kind is a canonical smoking-place record.
struct DestinationSuggestion: Identifiable, Equatable, Sendable {
    let id: String
    let title: String
    let subtitle: String?
    /// Known only for facility-search answers; a completion stays unlocated until it is tapped.
    var coordinate: SpotCoordinate? = nil
}

@MainActor
protocol DestinationCompleting {
    func suggestions(for text: String, near origin: SpotCoordinate?) async throws -> [DestinationSuggestion]
    func suggestions(for text: String, near origin: SpotCoordinate?,
                     onUpdate: @escaping @MainActor ([DestinationSuggestion]) -> Void) async throws -> [DestinationSuggestion]
    func resolve(_ suggestion: DestinationSuggestion, near origin: SpotCoordinate?) async throws -> PlaceDestination
}

extension DestinationCompleting {
    func suggestions(for text: String, near origin: SpotCoordinate?,
                     onUpdate: @escaping @MainActor ([DestinationSuggestion]) -> Void) async throws -> [DestinationSuggestion] {
        try await suggestions(for: text, near: origin)
    }
}

enum DestinationSuggestionRanker {
    /// Located candidates this close to the focus count as "in the area the query names".
    static let focusRadiusMeters = 20_000.0

    /// Titles equal to the query, then starting with it, then containing it. Within a tier, located candidates in the
    /// focus area (the place the query names, else the user's surroundings) come first, nearest first; the rest keep
    /// the provider's relevance order, because a completion has no coordinate until it is tapped.
    /// "上野" keeps 上野駅, 京成上野駅, 上野恩賜公園 and the 上野 area together; once a title equals the query,
    /// unnamed answers are unrelated places and are dropped, as in `DestinationResultMerger`.
    static func rank(query: String, _ suggestions: [DestinationSuggestion],
                     focus: SpotCoordinate? = nil) -> [DestinationSuggestion] {
        let needle = DestinationResultMerger.normalized(query)
        let focus = focus?.isValid == true ? focus : nil
        var seen = Set<String>()
        let ranked = suggestions.filter { seen.insert($0.id).inserted }.enumerated().map { entry in
            (offset: entry.offset, suggestion: entry.element,
             tier: DestinationResultMerger.nameTier(entry.element.title, needle),
             distance: focusDistance(entry.element, focus))
        }.sorted { a, b in
            if a.tier != b.tier { return a.tier < b.tier }
            switch (a.distance, b.distance) {
            case let (first?, second?): if first != second { return first < second }
            case (_?, nil): return true
            case (nil, _?): return false
            case (nil, nil): break
            }
            return a.offset < b.offset
        }
        let hasExactTitle = ranked.contains { $0.tier == 0 }
        var kept: [DestinationSuggestion] = []
        for entry in ranked where !(hasExactTitle && entry.tier == DestinationResultMerger.unnamedTier)
            && !kept.contains(where: { isSame($0, entry.suggestion) }) {
            kept.append(entry.suggestion)
        }
        return kept
    }

    private static func focusDistance(_ suggestion: DestinationSuggestion, _ focus: SpotCoordinate?) -> Double? {
        guard let focus, let coordinate = suggestion.coordinate, coordinate.isValid else { return nil }
        let distance = NearbySearch.straightLineDistance(from: focus, to: coordinate)
        return distance <= focusRadiusMeters ? distance : nil
    }

    /// The same place answered by a completion and a facility search. Same-named places with different addresses
    /// ("上野駅" in Tokyo and elsewhere) stay apart, so their subtitles tell them apart.
    private static func isSame(_ a: DestinationSuggestion, _ b: DestinationSuggestion) -> Bool {
        guard DestinationResultMerger.normalized(a.title) == DestinationResultMerger.normalized(b.title) else { return false }
        if let first = a.coordinate, let second = b.coordinate {
            return NearbySearch.straightLineDistance(from: first, to: second) <= DestinationResultMerger.duplicateMeters
        }
        guard let first = a.subtitle.map(DestinationResultMerger.normalized),
              let second = b.subtitle.map(DestinationResultMerger.normalized),
              !first.isEmpty, !second.isEmpty else { return false }
        return first.contains(second) || second.contains(first)
    }
}

/// The place a typed name refers to ("上野" → 上野駅 in Taito), so candidates around it rank ahead of same-named
/// places near the user. Temporary destination data only, never smoking evidence or a device location.
enum DestinationAnchor {
    /// The answer named exactly as `query`, preferring one around `origin` ("本町" typed in Osaka stays in Osaka);
    /// a lone answer otherwise. Anything else is ambiguous and leaves the ranking unanchored.
    static func pick(query: String, from places: [PlaceDestination], near origin: SpotCoordinate?) -> SpotCoordinate? {
        let needle = DestinationResultMerger.normalized(query)
        let exact = places.filter { DestinationResultMerger.normalized($0.name) == needle && $0.coordinate.isValid }
        if let origin, origin.isValid, let local = exact.first(where: {
            NearbySearch.straightLineDistance(from: origin, to: $0.coordinate) <= DestinationSuggestionRanker.focusRadiusMeters
        }) {
            return local.coordinate
        }
        if let first = exact.first { return first.coordinate }
        return places.count == 1 && places[0].coordinate.isValid ? places[0].coordinate : nil
    }
}

/// Merges a search biased to the user's surroundings with a nationwide one, so a named distant place ("上野駅" while
/// in Kanazawa) is found without losing the nearby preference for generic queries ("カフェ").
enum DestinationResultMerger {
    /// Results this close with the same name are one place reported by both searches.
    static let duplicateMeters = 150.0

    /// Names equal to the query, then starting with it, then containing it; within each, nearer first when `origin` is
    /// known. Unnamed answers ("カフェ" finding "Starbucks") keep MapKit's order, nearby before nationwide, unless a
    /// place is named exactly as the query: then they are unrelated places ("上野駅" answering local stations).
    /// Distance never removes a candidate and there is no display cap; MapKit already limits each response.
    static func merge(query: String, nearby: [PlaceDestination], nationwide: [PlaceDestination],
                      origin: SpotCoordinate? = nil) -> [PlaceDestination] {
        var unique: [PlaceDestination] = []
        for candidate in nearby + nationwide where !unique.contains(where: { isSame($0, candidate) }) {
            unique.append(candidate)
        }
        let needle = normalized(query)
        let ranked = unique.enumerated().sorted { a, b in
            let first = matchTier(a.element, needle), second = matchTier(b.element, needle)
            if first != second { return first < second }
            if first < unnamedTier, let origin, origin.isValid {
                let near = NearbySearch.straightLineDistance(from: origin, to: a.element.coordinate)
                let far = NearbySearch.straightLineDistance(from: origin, to: b.element.coordinate)
                if near != far { return near < far }
            }
            return a.offset < b.offset
        }
        let hasExactName = ranked.contains { matchTier($0.element, needle) == 0 }
        return ranked.map(\.element).filter { !hasExactName || matchTier($0, needle) < unnamedTier }
    }

    static let unnamedTier = 3

    private static func matchTier(_ place: PlaceDestination, _ needle: String) -> Int {
        nameTier(place.name, needle)
    }

    static func nameTier(_ text: String, _ needle: String) -> Int {
        guard !needle.isEmpty else { return unnamedTier }
        let name = normalized(text)
        if name == needle { return 0 }
        if name.hasPrefix(needle) { return 1 }
        return name.contains(needle) ? 2 : unnamedTier
    }

    /// Whether any answer is named for the query, which `merge` would rank first.
    static func containsNameMatch(for query: String, in places: [PlaceDestination]) -> Bool {
        let needle = normalized(query)
        return !needle.isEmpty && places.contains { normalized($0.name).contains(needle) }
    }

    private static func isSame(_ a: PlaceDestination, _ b: PlaceDestination) -> Bool {
        normalized(a.name) == normalized(b.name)
            && NearbySearch.straightLineDistance(from: a.coordinate, to: b.coordinate) <= duplicateMeters
    }

    static func normalized(_ text: String) -> String {
        text.folding(options: [.caseInsensitive, .widthInsensitive, .diacriticInsensitive], locale: nil)
            .filter { !$0.isWhitespace }
    }
}

@MainActor
protocol WalkingRouting {
    func route(from start: SpotCoordinate, to end: SpotCoordinate) async throws -> WalkingRoute
    func cancel()
}

struct RouteRankedResult: Sendable {
    let nearby: NearbyResult
    let detourSeconds: TimeInterval?
}

enum RouteDetourRanker {
    static let algorithmVersion = 1
    static let maximumRoutedCandidates = 5
    static let maximumDirectionsRequests = 1 + 2 * maximumRoutedCandidates
    static let maximumWalkingDetourDistanceMeters = 10_000.0

    static func canRequestWalkingDetours(from origin: SpotCoordinate, to destination: SpotCoordinate) -> Bool {
        guard origin.isValid, destination.isValid else { return false }
        let distance = NearbySearch.straightLineDistance(from: origin, to: destination)
        return distance.isFinite && distance <= maximumWalkingDetourDistanceMeters
    }

    // Straight-line excess is only a lower-cost shortlist heuristic. Actual ranking uses walking ETAs.
    static func candidates(
        _ results: [NearbyResult], from origin: SpotCoordinate, to destination: SpotCoordinate
    ) -> [NearbyResult] {
        let direct = NearbySearch.straightLineDistance(from: origin, to: destination)
        return Array(results.sorted {
            let first = excess($0, origin: origin, destination: destination, direct: direct)
            let second = excess($1, origin: origin, destination: destination, direct: direct)
            if first != second { return first < second }
            return $0.spot.id < $1.spot.id
        }.prefix(maximumRoutedCandidates))
    }

    static func detourSeconds(direct: TimeInterval, viaSpot: TimeInterval, onward: TimeInterval) -> TimeInterval? {
        guard direct.isFinite, viaSpot.isFinite, onward.isFinite,
              direct >= 0, viaSpot >= 0, onward >= 0 else { return nil }
        let viaTotal = viaSpot + onward
        guard viaTotal.isFinite else { return nil }
        return max(0, viaTotal - direct)
    }

    static func rank(_ results: [NearbyResult], detours: [String: TimeInterval]) -> [RouteRankedResult] {
        results.map { RouteRankedResult(nearby: $0, detourSeconds: detours[$0.spot.id]) }
            .sorted {
                switch ($0.detourSeconds, $1.detourSeconds) {
                case let (first?, second?):
                    if first != second { return first < second }
                case (_?, nil): return true
                case (nil, _?): return false
                case (nil, nil): break
                }
                if $0.nearby.distanceMeters != $1.nearby.distanceMeters {
                    return $0.nearby.distanceMeters < $1.nearby.distanceMeters
                }
                return $0.nearby.spot.id < $1.nearby.spot.id
            }
    }

    private static func excess(
        _ result: NearbyResult, origin: SpotCoordinate, destination: SpotCoordinate, direct: Double
    ) -> Double {
        let spot = SpotCoordinate(latitude: result.spot.latitude, longitude: result.spot.longitude)
        return result.distanceMeters + NearbySearch.straightLineDistance(from: spot, to: destination) - direct
    }
}
