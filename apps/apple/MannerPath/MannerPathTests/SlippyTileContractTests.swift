import Foundation
import Testing
@testable import MannerPath

private final class TileVectorBundleAnchor {}

private struct TileVectors: Decodable {
    struct Coordinate: Decodable {
        let name: String
        let lat: Double
        let lon: Double
        let z: Int
        let x: Int
        let y: Int
        let tileId: String
    }

    struct InvalidCoordinate: Decodable {
        let name: String
        let lat: Double
        let lon: Double
        let z: Int
    }

    struct TileID: Decodable {
        let tileId: String
        let z: Int
        let x: Int
        let y: Int
    }

    struct TileIDs: Decodable {
        let valid: [TileID]
        let invalid: [String]
    }

    let contract: String
    let version: Int
    let coordinateToTile: [Coordinate]
    let invalidCoordinates: [InvalidCoordinate]
    let tileIds: TileIDs

    static func load() throws -> Self {
        let bundle = Bundle(for: TileVectorBundleAnchor.self)
        let url = try #require(bundle.url(forResource: "slippy-xyz-vectors.v1", withExtension: "json"))
        return try JSONDecoder().decode(Self.self, from: Data(contentsOf: url))
    }
}

struct SlippyTileContractTests {
    @Test func contractIdentityAndDataZoom() throws {
        let vectors = try TileVectors.load()
        #expect(vectors.contract == "mannerpath-slippy-xyz-tile-vectors")
        #expect(vectors.version == 1)
        #expect(!vectors.coordinateToTile.isEmpty)
        #expect(SlippyTile.dataZoom == 14)
    }

    @Test func everyCoordinateVector() throws {
        for vector in try TileVectors.load().coordinateToTile {
            let tile = try SlippyTile.forCoordinate(
                latitude: vector.lat, longitude: vector.lon, zoom: vector.z
            )
            #expect(tile.z == vector.z, "\(vector.name)")
            #expect(tile.x == vector.x, "\(vector.name)")
            #expect(tile.y == vector.y, "\(vector.name)")
            #expect(tile.id == vector.tileId, "\(vector.name)")
        }
    }

    @Test func everyInvalidCoordinateVector() throws {
        for vector in try TileVectors.load().invalidCoordinates {
            #expect(throws: SlippyTileError.self, "\(vector.name)") {
                try SlippyTile.forCoordinate(latitude: vector.lat, longitude: vector.lon, zoom: vector.z)
            }
        }
    }

    @Test func everyValidTileIDVector() throws {
        for vector in try TileVectors.load().tileIds.valid {
            let tile = try #require(SlippyTile.parse(id: vector.tileId), "\(vector.tileId)")
            #expect(tile.z == vector.z)
            #expect(tile.x == vector.x)
            #expect(tile.y == vector.y)
            #expect(tile.id == vector.tileId)
        }
    }

    @Test func everyInvalidTileIDVector() throws {
        for id in try TileVectors.load().tileIds.invalid {
            #expect(SlippyTile.parse(id: id) == nil, "\(id)")
        }
    }

    @Test func nonFiniteInputsAndOverflowIDsAreRejected() {
        for value in [Double.nan, .infinity, -.infinity] {
            #expect(throws: SlippyTileError.self) {
                try SlippyTile.forCoordinate(latitude: value, longitude: 0, zoom: SlippyTile.dataZoom)
            }
            #expect(throws: SlippyTileError.self) {
                try SlippyTile.forCoordinate(latitude: 0, longitude: value, zoom: SlippyTile.dataZoom)
            }
        }
        #expect(SlippyTile.parse(id: "30/999999999999999999999999999999/0") == nil)
        #expect(SlippyTile.parse(id: "14/١/2") == nil)
        #expect(SlippyTile(z: 30, x: (1 << 30) - 1, y: 0) != nil)
    }

    @Test func maximumZoomProjectionUsesTheSameEdgeRules() throws {
        let tile = try SlippyTile.forCoordinate(latitude: 0, longitude: 180, zoom: SlippyTile.maximumZoom)
        #expect(tile.z == SlippyTile.maximumZoom)
        #expect(tile.x == 0)
        #expect(tile.y == (1 << (SlippyTile.maximumZoom - 1)))
        #expect(SlippyTile.parse(id: tile.id) == tile)
    }
}
