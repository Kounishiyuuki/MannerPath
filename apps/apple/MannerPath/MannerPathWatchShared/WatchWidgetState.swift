import Foundation

nonisolated enum WatchWidgetState: Equatable {
    case unavailable, stale, empty, saved

    static func evaluate(_ snapshot: WatchSnapshot?, at now: Date) -> Self {
        guard let snapshot else { return .unavailable }
        guard now >= snapshot.generatedAt,
              now.timeIntervalSince(snapshot.generatedAt) <= 3_600 else { return .stale }
        return snapshot.spots.isEmpty ? .empty : .saved
    }
}
