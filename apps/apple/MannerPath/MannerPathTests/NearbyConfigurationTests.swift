import Foundation
import Testing
@testable import MannerPath

@MainActor
struct NearbyConfigurationTests {
    @Test func acceptsOnlyHTTPOrigins() {
        #expect(NearbyComposition.apiBaseURL(from: nil) == nil)
        #expect(NearbyComposition.apiBaseURL(from: "") == nil)
        #expect(NearbyComposition.apiBaseURL(from: "invalid") == nil)
        #expect(NearbyComposition.apiBaseURL(from: "file:///tmp") == nil)
        #expect(NearbyComposition.apiBaseURL(from: "ftp://example.invalid") == nil)
        #expect(NearbyComposition.apiBaseURL(from: "https://example.invalid")?.absoluteString == "https://example.invalid")
        #expect(NearbyComposition.apiBaseURL(from: "http://example.invalid")?.absoluteString == "http://example.invalid")
    }
}
