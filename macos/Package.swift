// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "ILIASSync",
    platforms: [.macOS(.v15)],
    targets: [
        .executableTarget(name: "ILIASSync", path: "Sources/ILIASSync"),
    ],
    swiftLanguageModes: [.v5]
)
