import Foundation

/// Written by the background job (`ilias-sync watch`) next to its config.
struct DaemonInfo: Decodable {
    let port: Int
    let token: String
}

struct DaemonStatus: Decodable {
    let state: String
    let message: String?
    let lastRun: LastRun?
    let nextRun: String?
    let recent: [RecentFile]
    let courses: [CourseRef]

    struct LastRun: Decodable {
        let startedAt: String
        let finishedAt: String
        let ok: Bool
        let added: Int
        let updated: Int
        let errors: Int
    }

    struct RecentFile: Decodable, Identifiable {
        let label: String
        let path: String
        let updated: Bool
        let at: String
        var id: String { path + at }
    }

    struct CourseRef: Decodable, Hashable {
        let title: String
        let targetDir: String
    }
}

struct CourseConfig: Codable, Hashable, Identifiable {
    var refId: String
    var title: String
    var targetDir: String
    var videos: Bool
    var id: String { refId }
}

struct ConfigResponse: Decodable {
    let configured: Bool
    let hasPassword: Bool
    let baseUrl: String?
    let username: String?
    let intervalMinutes: Double?
    let baseDir: String?
    let courses: [CourseConfig]?
}

struct AvailableCourse: Decodable, Identifiable, Hashable {
    let refId: String
    let type: String
    let title: String
    let group: String?
    /// Short heading, e.g. "WS 26/27"; courses arrive sorted newest semester first.
    let groupLabel: String
    /// File-system-safe course title, computed by the background job.
    let folderName: String
    var id: String { refId }
}

struct Credentials: Encodable {
    let baseUrl: String
    let username: String
    let password: String?
}

struct SavePayload: Encodable, Equatable {
    var baseUrl: String
    var username: String
    var password: String?
    var intervalMinutes: Int
    var baseDir: String?
    var courses: [CourseConfig]
}

struct OkResponse: Decodable {
    let ok: Bool
}

enum ISODate {
    private static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    static func parse(_ string: String?) -> Date? {
        guard let string else { return nil }
        return withFraction.date(from: string) ?? ISO8601DateFormatter().date(from: string)
    }
}
