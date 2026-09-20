import Foundation
import Testing
@testable import MannerPath

struct SpotPresentationTests {
    @Test func unknownValuesRemainExplicitlyUnknown() {
        #expect(SpotPresentation.type(.unknown) == "Unknown physical type")
        #expect(SpotPresentation.access(.unknown) == "Unknown")
        #expect(SpotPresentation.environment(.unknown) == "Unknown")
        #expect(SpotPresentation.tobacco(.unknown) == "Unknown")
        #expect(SpotPresentation.tobacco(.no) == "Confirmed not supported")
        #expect(SpotPresentation.hoursState(nil) == "Unknown")
        #expect(SpotPresentation.evidence(nil) == "Unknown")
        #expect(SpotPresentation.verificationDate(nil) == "Unknown")
    }

    @Test func unparsedHoursDoNotBecomeAnOpenStatus() {
        let hours = SpotOpeningHours(raw: "営業時間は現地確認", parsed: nil,
                                     status: .unparsed, timeZone: "Asia/Tokyo")
        #expect(SpotPresentation.hoursState(hours) == "Unconfirmed; raw text only")
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
}
