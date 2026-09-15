import Foundation

enum ShareURL {
    static let intakeBaseURL = URL(string: "https://feelslikehome.app/homes")!

    static func defensibleWebURL(_ candidate: URL?) -> URL? {
        guard let candidate,
              let components = URLComponents(url: candidate, resolvingAgainstBaseURL: false),
              let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              components.host?.isEmpty == false else {
            return nil
        }
        return candidate
    }

    static func fromText(_ text: String) -> URL? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let whole = URL(string: trimmed), let valid = defensibleWebURL(whole) {
            return valid
        }

        // Some share sources send a title followed by one URL as plain text.
        // Accept exactly one defensible URL token; multiple links are ambiguous.
        let edgePunctuation = CharacterSet(charactersIn: "<>[]{}()\"'.,;!")
        let candidates = trimmed
            .components(separatedBy: .whitespacesAndNewlines)
            .map { $0.trimmingCharacters(in: edgePunctuation) }
            .compactMap(URL.init(string:))
            .compactMap(defensibleWebURL)
        return candidates.count == 1 ? candidates[0] : nil
    }

    static func intakeURL(for sharedURL: URL) -> URL? {
        guard let sharedURL = defensibleWebURL(sharedURL),
              var components = URLComponents(url: intakeBaseURL, resolvingAgainstBaseURL: false) else {
            return nil
        }
        components.queryItems = [URLQueryItem(name: "url", value: sharedURL.absoluteString)]
        return components.url
    }
}
