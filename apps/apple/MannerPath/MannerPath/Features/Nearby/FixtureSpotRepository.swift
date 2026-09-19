import Foundation

protocol SpotRepository: Sendable {
    func allSpots() -> [Spot]
}

struct FixtureSpotRepository: SpotRepository {
    private let spots: [Spot]

    init(data: Data) throws {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        spots = try decoder.decode([Spot].self, from: data)
    }

    init(bundle: Bundle = .main) throws {
        guard let url = bundle.url(forResource: "nearby-spots", withExtension: "json") else {
            throw FixtureError.missingResource
        }
        try self.init(data: Data(contentsOf: url))
    }

    func allSpots() -> [Spot] { spots }
}

enum FixtureError: Error {
    case missingResource
}
