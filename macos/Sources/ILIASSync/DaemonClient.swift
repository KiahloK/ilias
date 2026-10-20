import Foundation

enum DaemonError: LocalizedError {
    case notRunning
    case server(String)

    var errorDescription: String? {
        switch self {
        case .notRunning: return "The background sync is not running."
        case .server(let message): return message
        }
    }
}

private struct ErrorBody: Decodable {
    let error: String
}

/// Talks to the control API of the background job on 127.0.0.1.
enum DaemonClient {
    static let configDir = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".config/ilias-sync")
    static let logFile = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Logs/ilias-sync.log")

    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        // Logging in and listing courses goes through ILIAS, which can be slow.
        config.timeoutIntervalForRequest = 60
        return URLSession(configuration: config)
    }()

    /// Re-read on every call: the port and token change whenever the background job restarts.
    private static func info() throws -> DaemonInfo {
        let url = configDir.appendingPathComponent("daemon.json")
        guard let data = try? Data(contentsOf: url) else { throw DaemonError.notRunning }
        return try JSONDecoder().decode(DaemonInfo.self, from: data)
    }

    static func request<T: Decodable>(_ method: String, _ path: String, body: (any Encodable)? = nil) async throws -> T {
        let info = try info()
        var request = URLRequest(url: URL(string: "http://127.0.0.1:\(info.port)\(path)")!)
        request.httpMethod = method
        request.setValue("Bearer \(info.token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.httpBody = try JSONEncoder().encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError where error.code == .cannotConnectToHost {
            throw DaemonError.notRunning
        }

        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error ?? "HTTP \(status)"
            throw DaemonError.server(message)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    /// Asks launchd to (re)start the background job installed by `ilias-sync install`.
    static func restartBackgroundJob() {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = ["kickstart", "-k", "gui/\(getuid())/de.ilias-sync.watch"]
        try? process.run()
    }
}
