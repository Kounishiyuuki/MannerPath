import Foundation
import Testing
@testable import MannerPath

struct SourceAttributionTests {
    @Test func licenseLinksRequireAbsoluteHTTPOrHTTPSWithoutCredentials() {
        for rawURL in ["https://creativecommons.org/licenses/by/4.0/", "http://example.org/license", "HTTPS://example.org/license"] {
            #expect(SourceAttributionPresentation.licenseURL(rawURL) != nil)
        }
        let invalidURLs: [String?] = [nil, "", "not a URL", "/license", "https:", "https://", "https:license",
                              "javascript:alert(1)", "file:///license", "https://user:pass@example.org/license",
                              "https://example.org/a b", "https://example.org/\nlicense"]
        for rawURL in invalidURLs {
            #expect(SourceAttributionPresentation.licenseURL(rawURL) == nil)
        }
    }

    @Test func modificationNoticeIsSeparateFromPrescribedTaitoAttributionAndSurvivesWatchTransfer() throws {
        let prescribed = "台東区 CC-BY表示4.0国際 本作品の内容について、台東区は一切保証しないものとする。 元データ https://www.city.taito.lg.jp/kusei/online/opendata/seikatu/shisethutizujouhou.files/20260818_koshukitsuenjo.csv"
        let license = "https://creativecommons.org/licenses/by/4.0/legalcode.ja"
        let source = SpotSource(id: "taito-public-smoking-areas", displayName: "台東区", licenseName: "CC BY 4.0",
            licenseURL: license, attributionText: prescribed)
        let spot = Spot(id: "taito", mergedInto: nil, name: "Place", latitude: 35, longitude: 139,
            tileId: "14/1/1", spotType: .ashtray, hostType: nil, accessType: .unknown, environment: .unknown,
            supportsPaper: .unknown, supportsHeated: .unknown, openingHours: nil, feeType: nil, floor: nil,
            entranceNote: nil, lifecycle: .active,
            verification: SpotVerification(acceptedExistenceEvidence: .yes, evidenceQuality: "officialListing",
                sourceDisplayNames: ["台東区"], evidenceQualityVersion: "evidence-quality.v1", sources: [source]),
            lastVerifiedAt: nil, createdAt: nil, updatedAt: nil)
        let snapshot = WatchSnapshotBuilder.build(spots: [spot], sources: [source],
            near: SpotCoordinate(latitude: 35, longitude: 139), at: .now)
        let decoded = try WatchCodec.snapshot(WatchCodec.encode(snapshot))
        #expect(decoded.sources.count == 1)
        #expect(decoded.sources[0].attributionText == prescribed)
        #expect(Array(try #require(decoded.sources[0].attributionText).utf8) == Array(prescribed.utf8))
        #expect(decoded.sources[0].licenseURL == license)
        #expect(SourceAttributionPresentation.licenseURL(decoded.sources[0].licenseURL)?.absoluteString == license)
        #expect(SourceAttributionPresentation.modificationNotice == String(localized: "MannerPath extracts and normalizes smoking-place data from the original sources. Some access conditions and opening hours may be treated conservatively; unknown conditions are not confirmation."))
        #expect(!prescribed.contains(SourceAttributionPresentation.modificationNotice))
    }
}
