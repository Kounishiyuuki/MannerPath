import Foundation

@MainActor
enum NearbyComposition {
    static func makeModel() -> NearbyModel {
        let store: GRDBTileStore?
        do {
            let support = try FileManager.default.url(
                for: .applicationSupportDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: true
            )
            store = try GRDBTileStore(path: support.appendingPathComponent("nearby-tiles.sqlite").path)
        } catch {
            store = nil
        }

        let refresher: TileSyncService?
        if let store, let baseURL = apiBaseURL {
            refresher = TileSyncService(client: TileAPIClient(baseURL: baseURL), store: store)
        } else {
            refresher = nil
        }
        return NearbyModel(
            location: DeviceLocationService(), repository: store, refresher: refresher,
            destinationSearch: MapKitDestinationSearch(), walkingRouter: MapKitWalkingRouter()
        )
    }

    static var apiBaseURL: URL? {
        apiBaseURL(from: Bundle.main.object(forInfoDictionaryKey: "MannerPathAPIBaseURL") as? String)
    }

    static func apiBaseURL(from value: String?) -> URL? {
        guard let value,
              let url = URL(string: value),
              ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
              url.host != nil else { return nil }
        return url
    }
}
