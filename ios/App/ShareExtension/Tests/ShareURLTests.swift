import Foundation
import Testing
@testable import ShareExtensionCore

@Test func acceptsHTTPAndHTTPS() {
    #expect(ShareURL.defensibleWebURL(URL(string: "http://example.com/home")) != nil)
    #expect(ShareURL.defensibleWebURL(URL(string: "https://example.com/home")) != nil)
}

@Test func rejectsMalformedAndUnsupportedURLs() {
    #expect(ShareURL.defensibleWebURL(URL(string: "not a URL")) == nil)
    #expect(ShareURL.defensibleWebURL(URL(string: "javascript:alert(1)")) == nil)
    #expect(ShareURL.defensibleWebURL(URL(string: "file:///tmp/home")) == nil)
    #expect(ShareURL.defensibleWebURL(URL(string: "https:///missing-host")) == nil)
}

@Test func preservesNestedQueryAndFragment() throws {
    let original = try #require(URL(string: "https://www.example.com/listing/123?foo=bar&next=https%3A%2F%2Fother.test#photos"))
    let intake = try #require(ShareURL.intakeURL(for: original))
    let nested = try #require(URLComponents(url: intake, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "url" }?.value)
    #expect(intake.scheme == "https")
    #expect(intake.host == "feelslikehome.app")
    #expect(intake.path == "/homes")
    #expect(nested == original.absoluteString)
}

@Test func safelyRepresentsSpacesAndUnicode() throws {
    let original = try #require(URL(string: "https://example.com/My%20Home/%F0%9F%8F%A0?q=caf%C3%A9"))
    let intake = try #require(ShareURL.intakeURL(for: original))
    let nested = try #require(URLComponents(url: intake, resolvingAgainstBaseURL: false)?.queryItems?.first?.value)
    #expect(nested == original.absoluteString)
}

@Test func acceptsOneURLInTextButRejectsAmbiguityAndAbsence() {
    #expect(ShareURL.fromText("A lovely home\nhttps://example.com/listing/123")?.absoluteString == "https://example.com/listing/123")
    #expect(ShareURL.fromText("https://one.test https://two.test") == nil)
    #expect(ShareURL.fromText("A lovely home with no link") == nil)
    #expect(ShareURL.fromText("") == nil)
}
