import Foundation
import Testing
@testable import MannerPath

struct SpotPresentationTests {
    @Test func unknownValuesRemainExplicitlyUnknown() {
        #expect(SpotPresentation.type(.unknown) == String(localized: "Unknown physical type"))
        #expect(SpotPresentation.access(.unknown) == String(localized: "Unknown"))
        #expect(SpotPresentation.environment(.unknown) == String(localized: "Unknown"))
        #expect(SpotPresentation.tobacco(.unknown) == String(localized: "Unknown"))
        #expect(SpotPresentation.tobacco(.no) == String(localized: "Confirmed not supported"))
        #expect(SpotPresentation.hoursState(nil) == String(localized: "Unknown"))
        #expect(SpotPresentation.evidence(nil, version: nil) == String(localized: "Unknown"))
        #expect(SpotPresentation.evidence("futureEvidenceV2", version: "evidence-quality.v2") == String(localized: "Evidence confidence unknown"))
        #expect(SpotPresentation.evidence("officialListing", version: "evidence-quality.v2") == String(localized: "Evidence confidence unknown"))
        #expect(SpotPresentation.evidence("officialListing", version: nil) == String(localized: "Evidence confidence unknown"))
        #expect(SpotPresentation.evidence("officialListing", version: "evidence-quality.v1") == String(localized: "Official listing"))
        #expect(SpotPresentation.verificationDate(nil) == String(localized: "Unknown"))
    }

    @Test func unparsedHoursDoNotBecomeAnOpenStatus() {
        let hours = SpotOpeningHours(raw: "営業時間は現地確認", parsed: nil,
                                     status: .unparsed, timeZone: "Asia/Tokyo")
        #expect(SpotPresentation.hoursState(hours) == String(localized: "Unconfirmed source text"))
    }

    @Test func blankSourceNamesNeverRenderAsEmptyAttribution() {
        #expect(SpotPresentation.sourceNames(["  ", "\n"]) == String(localized: "Source name unavailable"))
        #expect(SpotPresentation.sourceNames(["  ", "Ward listing"]) == "Ward listing")
    }

    @Test func verificationDayUsesUTCForDateOnlyEvidence() throws {
        let date = try #require(ISO8601DateFormatter().date(from: "2026-09-20T00:00:00Z"))
        let utc = DateFormatter()
        utc.dateStyle = .medium
        utc.timeZone = TimeZone(secondsFromGMT: 0)
        let west = DateFormatter()
        west.dateStyle = .medium
        west.timeZone = TimeZone(secondsFromGMT: -8 * 3_600)

        #expect(SpotPresentation.verificationDate(date) == utc.string(from: date))
        #expect(SpotPresentation.verificationDate(date) != west.string(from: date))
    }

    @Test func bearingNamesTheCompassDirection() {
        #expect(SpotPresentation.compassDirection(0) == String(localized: "North"))
        #expect(SpotPresentation.compassDirection(22.4) == String(localized: "North"))
        #expect(SpotPresentation.compassDirection(22.5) == String(localized: "Northeast"))
        #expect(SpotPresentation.compassDirection(238) == String(localized: "Southwest"))
        #expect(SpotPresentation.compassDirection(337.5) == String(localized: "North"))
        #expect(SpotPresentation.compassDirection(359.9) == String(localized: "North"))
        #expect(SpotPresentation.compassDirection(-90) == String(localized: "West"))
    }
}
