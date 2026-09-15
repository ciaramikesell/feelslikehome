import UIKit
import UniformTypeIdentifiers
import os

final class ShareViewController: UIViewController {
    private let logger = Logger(subsystem: "app.feelslikehome.mobile.share", category: "ShareHandoff")
    private let statusLabel = UILabel()
    private let dismissButton = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        logger.info("Share Extension loaded")
        configureView()
        Task { await handOffFirstUsableURL() }
    }

    private func configureView() {
        view.backgroundColor = .systemBackground
        statusLabel.text = "Opening Feels Like Home…"
        statusLabel.font = .preferredFont(forTextStyle: .headline)
        statusLabel.textAlignment = .center
        statusLabel.numberOfLines = 0
        statusLabel.translatesAutoresizingMaskIntoConstraints = false

        dismissButton.setTitle("Close", for: .normal)
        dismissButton.isHidden = true
        dismissButton.addTarget(self, action: #selector(dismissExtension), for: .touchUpInside)
        dismissButton.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(statusLabel)
        view.addSubview(dismissButton)
        NSLayoutConstraint.activate([
            statusLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            statusLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -12),
            statusLabel.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
            statusLabel.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -24),
            dismissButton.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 16),
            dismissButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
        ])
    }

    private func handOffFirstUsableURL() async {
        guard let sharedURL = await loadSharedURL(),
              let intakeURL = ShareURL.intakeURL(for: sharedURL) else {
            logger.error("No usable web URL extracted")
            showFailure("We couldn’t find a web link to open.")
            return
        }

        // Deliberately omit both URLs from the log: the nested value may be a
        // private listing and the intake path may later carry auth context.
        logger.info("Usable URL extracted; requesting Universal Link handoff")
        extensionContext?.open(intakeURL) { [weak self] opened in
            DispatchQueue.main.async {
                if opened {
                    self?.logger.info("Universal Link handoff accepted by iOS")
                    self?.extensionContext?.completeRequest(returningItems: nil)
                } else {
                    self?.logger.error("Universal Link handoff rejected by iOS")
                    self?.showFailure("Feels Like Home couldn’t be opened. Please try again.")
                }
            }
        }
    }

    private func loadSharedURL() async -> URL? {
        let providers = extensionContext?.inputItems
            .compactMap { $0 as? NSExtensionItem }
            .flatMap { $0.attachments ?? [] } ?? []

        // Prefer native URL representations over fallback text, preserving
        // the source app's attachment order without provider-specific logic.
        for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            if let value = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier),
               let url = url(from: value),
               let valid = ShareURL.defensibleWebURL(url) {
                return valid
            }
        }
        for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            if let value = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier),
               let text = text(from: value),
               let valid = ShareURL.fromText(text) {
                return valid
            }
        }
        return nil
    }

    private func url(from item: NSSecureCoding?) -> URL? {
        if let url = item as? URL { return url }
        if let string = item as? String { return URL(string: string) }
        if let data = item as? Data { return URL(string: String(decoding: data, as: UTF8.self)) }
        return nil
    }

    private func text(from item: NSSecureCoding?) -> String? {
        if let string = item as? String { return string }
        if let url = item as? URL { return url.absoluteString }
        if let data = item as? Data { return String(decoding: data, as: UTF8.self) }
        return nil
    }

    private func showFailure(_ message: String) {
        DispatchQueue.main.async { [weak self] in
            self?.statusLabel.text = message
            self?.dismissButton.isHidden = false
        }
    }

    @objc private func dismissExtension() {
        extensionContext?.cancelRequest(withError: NSError(
            domain: "FeelsLikeHomeShare",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "The shared item could not be opened."]
        ))
    }
}
