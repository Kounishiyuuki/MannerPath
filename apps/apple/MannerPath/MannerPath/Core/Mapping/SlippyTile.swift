import Foundation

nonisolated enum SlippyTileError: Error {
    case invalidZoom
    case invalidCoordinate
}

// Shared with services/api/src/geo/tile.ts through the JSON vectors in contracts/tiles.
nonisolated struct SlippyTile: Equatable, Hashable, Sendable {
    static let dataZoom = 14
    static let maximumZoom = 30
    private static let maximumMercatorLatitude = 85.05112877980659

    let z: Int
    let x: Int
    let y: Int

    init?(z: Int, x: Int, y: Int) {
        guard (0...Self.maximumZoom).contains(z) else { return nil }
        let tileCount = 1 << z
        guard (0..<tileCount).contains(x), (0..<tileCount).contains(y) else { return nil }
        self.z = z
        self.x = x
        self.y = y
    }

    static func forCoordinate(latitude: Double, longitude: Double, zoom: Int) throws -> Self {
        guard (0...maximumZoom).contains(zoom) else { throw SlippyTileError.invalidZoom }
        guard latitude.isFinite, longitude.isFinite,
              (-90...90).contains(latitude), (-180...180).contains(longitude) else {
            throw SlippyTileError.invalidCoordinate
        }

        let tileCount = 1 << zoom
        let x = Int(floor((longitude + 180) / 360 * Double(tileCount))) % tileCount
        let clampedLatitude = max(-maximumMercatorLatitude, min(maximumMercatorLatitude, latitude))
        let phi = clampedLatitude * .pi / 180
        let rawY = Int(floor((1 - log(tan(phi) + 1 / cos(phi)) / .pi) / 2 * Double(tileCount)))
        let y = max(0, min(tileCount - 1, rawY))
        return Self(z: zoom, x: x, y: y)!
    }

    var id: String { "\(z)/\(x)/\(y)" }

    static func parse(id: String) -> Self? {
        let parts = id.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 3,
              let z = canonicalInteger(parts[0]),
              let x = canonicalInteger(parts[1]),
              let y = canonicalInteger(parts[2]) else { return nil }
        return Self(z: z, x: x, y: y)
    }

    private static func canonicalInteger(_ text: Substring) -> Int? {
        let bytes = text.utf8
        guard let first = bytes.first,
              (first == 48 && bytes.count == 1) || (49...57).contains(first),
              bytes.allSatisfy({ (48...57).contains($0) }) else { return nil }
        return Int(text)
    }
}
