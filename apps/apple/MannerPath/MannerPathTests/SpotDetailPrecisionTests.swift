import Foundation
import SwiftUI
import Testing
import UIKit
@testable import MannerPath

// Phase 3 Spot Detail: location precision is described for every value (nil included) by the production helpers,
// independently of the existence evidence, and the directions wording follows precision alone. Each case is an
// explicit precision fixture, not inferred from whether a precision note happens to be shown (#208 review).
struct SpotDetailPrecisionTests {
    private let tile = SlippyTile(z: 14, x: 14553, y: 6449)!
    private let origin = SpotCoordinate(latitude: 35.7112, longitude: 139.77377)

    private static let place = "Navigate to this place"
    private static let area = "Navigate to this area"

    /// precision → (directions key, its Japanese text, exact?)
    private static let expectations: [(LocationPrecision?, String, String, Bool)] = [
        (.publisherPoint, place, "この場所へ案内", true),
        (.communityPinned, place, "この場所へ案内", true),
        (.areaApproximate, area, "この付近へ案内", false),
        (.reviewedDerived, area, "この付近へ案内", false),
        (.unknown, area, "この付近へ案内", false),
        (LocationPrecision(wire: "someFuturePrecision"), area, "この付近へ案内", false),
        (nil, area, "この付近へ案内", false)
    ]

    @Test func directionsWordingFollowsExplicitPrecision() throws {
        let japanese = try #require(Bundle.main.path(forResource: "ja", ofType: "lproj").flatMap(Bundle.init(path:)))
        for (precision, key, ja, exact) in Self.expectations {
            let spot = spot(precision: precision)
            #expect(SpotPresentation.navigationTitle(spot) == String(localized: String.LocalizationValue(key)),
                    "\(String(describing: precision))")
            #expect(japanese.localizedString(forKey: key, value: nil, table: nil) == ja, "\(String(describing: precision))")
            #expect(SpotPresentation.isExactPoint(spot) == exact, "\(String(describing: precision))")
        }
    }

    @Test func everyPrecisionIsDescribedAndNeverCalledOfficial() throws {
        let japanese = try #require(Bundle.main.path(forResource: "ja", ofType: "lproj").flatMap(Bundle.init(path:)))
        func ja(_ key: String) -> String { japanese.localizedString(forKey: key, value: nil, table: nil) }
        #expect(SpotPresentation.precisionDescription(spot(precision: .publisherPoint)) == String(localized: "Location shown by the publisher"))
        #expect(ja("Location shown by the publisher") == "公開元が示した地点")
        #expect(SpotPresentation.precisionDescription(spot(precision: .communityPinned)) == String(localized: "Location shown by a user"))
        #expect(ja("Location shown by a user") == "利用者が示した地点")
        #expect(SpotPresentation.precisionDescription(spot(precision: .reviewedDerived)) == String(localized: "Location estimated from the official address"))
        #expect(ja("Location estimated from the official address") == "公式住所から推定した位置")
        let named = spot(precision: .areaApproximate, area: LocationArea(name: "上野恩賜公園", kind: "park"))
        #expect(SpotPresentation.precisionDescription(named) == SpotPresentation.approximateLocationNote(named))
        for unknown in [LocationPrecision.unknown, LocationPrecision(wire: "someFuturePrecision"), nil] as [LocationPrecision?] {
            #expect(SpotPresentation.precisionDescription(spot(precision: unknown)) == String(localized: "Location precision unknown"))
            #expect(SpotPresentation.precisionSymbol(spot(precision: unknown)) == "questionmark.circle")
        }
        // A user's pin is exact, but it is not the publisher's point and never reads as official.
        #expect(!ja("Location shown by a user").contains("公式"))
        #expect(SpotPresentation.precisionSymbol(spot(precision: .areaApproximate)) == "mappin.and.ellipse")
    }

    @Test func precisionDoesNotFollowEvidenceAndEvidenceDoesNotFollowPrecision() {
        // Same precision, different evidence: same description. Same evidence, different precision: same evidence label.
        let officialApprox = spot(precision: .areaApproximate, existence: .official)
        let communityApprox = spot(precision: .areaApproximate, existence: .communityReported)
        #expect(SpotPresentation.precisionDescription(officialApprox) == SpotPresentation.precisionDescription(communityApprox))
        #expect(SpotPresentation.navigationTitle(officialApprox) == SpotPresentation.navigationTitle(communityApprox))
        let officialExact = spot(precision: .publisherPoint, existence: .official)
        #expect(SpotPresentation.evidence(officialExact) == SpotPresentation.evidence(officialApprox))
        let reportedPinned = spot(precision: .communityPinned, existence: .communityReported)
        #expect(SpotPresentation.isExactPoint(reportedPinned), "a user's on-site pin is exact even for a single report")
        #expect(SpotPresentation.evidence(reportedPinned) != SpotPresentation.evidence(officialExact))
    }

    // Renders the real Spot Detail for visual review (exact / user pin / approximate / unknown × text size × appearance).
    // Runs only when TEST_RUNNER_MP_DETAIL_SNAPSHOT_DIR is set; writes PNGs there.
    @MainActor
    @Test(.enabled(if: ProcessInfo.processInfo.environment["MP_DETAIL_SNAPSHOT_DIR"] != nil))
    func renderDetailSnapshots() async throws {
        let directory = URL(fileURLWithPath: try #require(ProcessInfo.processInfo.environment["MP_DETAIL_SNAPSHOT_DIR"]))
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let scene = try #require(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let cases: [(String, Spot, String?)] = [
            ("exact-official", spot(precision: .publisherPoint, existence: .official, name: "佐竹公衆喫煙所"), nil),
            ("pinned-community", spot(precision: .communityPinned, existence: .communityReported, name: "灰皿のある場所"), nil),
            ("approximate-official", spot(precision: .areaApproximate, existence: .official, name: "公園内喫煙所",
                                          area: LocationArea(name: "上野恩賜公園", kind: "park")),
             String(localized: "Showing saved nearby data. Live updates are unavailable.")),
            ("unknown-legacy", spot(precision: nil, existence: .unknown, name: "喫煙所"), nil)
        ]
        let variants: [(String, DynamicTypeSize, UIUserInterfaceStyle)] = [
            ("normal-light", .large, .light), ("normal-dark", .large, .dark),
            ("ax5-light", .accessibility5, .light), ("ax5-dark", .accessibility5, .dark)
        ]
        for (name, spot, notice) in cases {
            for (variant, size, style) in variants {
                let result = NearbyResult(spot: spot, distanceMeters: 560, bearingDegrees: 317, verificationAge: 6 * 86_400)
                let view = NavigationStack {
                    SpotDetailView(result: result, locationAccuracyMeters: 5, estimateFromPreviousLocation: false,
                                   routeOrigin: nil, nearbySources: [], reportAvailability: .unavailable,
                                   hasSavedReport: false, cacheNotice: notice, onReport: { _ in }, onConfirmStillHere: {})
                }
                .environment(\.dynamicTypeSize, size)
                let host = UIHostingController(rootView: view)
                host.overrideUserInterfaceStyle = style
                let window = UIWindow(windowScene: scene)
                window.frame = CGRect(x: 0, y: 0, width: 402, height: size.isAccessibilitySize ? 2600 : 1400)
                window.rootViewController = host
                window.isHidden = false
                try await Task.sleep(for: .seconds(1))
                let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
                    window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
                }
                try #require(image.pngData()).write(to: directory.appending(path: "\(name)-\(variant).png"))
                window.isHidden = true
            }
        }
    }

    // MARK: - fixtures

    private func spot(precision: LocationPrecision?, existence: ExistenceEvidence = .official, name: String = "spot",
                      area: LocationArea? = nil) -> Spot {
        Spot(id: name, mergedInto: nil, name: name, latitude: origin.latitude, longitude: origin.longitude,
             tileId: tile.id, spotType: .designatedOutdoorArea, hostType: nil, accessType: .public, environment: .unknown,
             supportsPaper: .unknown, supportsHeated: .unknown, openingHours: nil, feeType: nil, floor: nil,
             entranceNote: nil, lifecycle: .active,
             verification: SpotVerification(acceptedExistenceEvidence: .yes, evidenceQuality: "officialListing",
                                            sourceDisplayNames: [], evidenceQualityVersion: "evidence-quality.v1",
                                            existence: existence, locationPrecision: precision, lastReviewedMonth: "2026-09",
                                            locationArea: area),
             lastVerifiedAt: nil, createdAt: nil, updatedAt: nil)
    }
}
