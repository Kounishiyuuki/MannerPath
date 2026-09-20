import Testing
@testable import MannerPath

struct NearbyTileModelTests {
    @Test func normalTileIncludesCurrentAndEightUniqueNeighbors() {
        let tile = SlippyTile(z: 14, x: 14553, y: 6449)!
        let neighbors = tile.neighborhood3x3()

        #expect(neighbors.count == 9)
        #expect(Set(neighbors) == Set(
            (14552...14554).flatMap { x in
                (6448...6450).map { y in SlippyTile(z: 14, x: x, y: y)! }
            }
        ))
    }

    @Test func worldEdgesClipLatitudeAndWrapLongitudeWithoutDuplicates() {
        let northWest = SlippyTile(z: 14, x: 0, y: 0)!
        #expect(Set(northWest.neighborhood3x3()) == Set([
            SlippyTile(z: 14, x: 16383, y: 0)!,
            SlippyTile(z: 14, x: 0, y: 0)!,
            SlippyTile(z: 14, x: 1, y: 0)!,
            SlippyTile(z: 14, x: 16383, y: 1)!,
            SlippyTile(z: 14, x: 0, y: 1)!,
            SlippyTile(z: 14, x: 1, y: 1)!
        ]))

        let southEast = SlippyTile(z: 14, x: 16383, y: 16383)!
        #expect(Set(southEast.neighborhood3x3()) == Set([
            SlippyTile(z: 14, x: 16382, y: 16382)!,
            SlippyTile(z: 14, x: 16383, y: 16382)!,
            SlippyTile(z: 14, x: 0, y: 16382)!,
            SlippyTile(z: 14, x: 16382, y: 16383)!,
            SlippyTile(z: 14, x: 16383, y: 16383)!,
            SlippyTile(z: 14, x: 0, y: 16383)!
        ]))

        #expect(SlippyTile(z: 0, x: 0, y: 0)!.neighborhood3x3() == [SlippyTile(z: 0, x: 0, y: 0)!])
        #expect(Set(SlippyTile(z: 1, x: 0, y: 0)!.neighborhood3x3()).count == 4)
    }
}
