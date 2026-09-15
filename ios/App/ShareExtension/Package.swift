// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ShareExtensionCore",
    platforms: [.macOS(.v13)],
    products: [.library(name: "ShareExtensionCore", targets: ["ShareExtensionCore"])],
    targets: [
        .target(
            name: "ShareExtensionCore",
            path: ".",
            exclude: ["Info.plist", "Package.swift", "ShareViewController.swift", "Tests"],
            sources: ["ShareURL.swift"]
        ),
        .testTarget(name: "ShareExtensionCoreTests", dependencies: ["ShareExtensionCore"], path: "Tests"),
    ]
)
