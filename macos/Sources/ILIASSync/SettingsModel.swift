import AppKit
import Foundation

@MainActor
final class SettingsModel: ObservableObject {
    @Published var baseUrl = "https://ilias3.uni-stuttgart.de/"
    @Published var username = ""
    /// Empty means "keep the stored password".
    @Published var password = ""
    @Published private(set) var hasPassword = false
    @Published var intervalMinutes = 30
    @Published var baseDir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("ILIAS").path

    /// Selected courses keyed by refId.
    @Published var selected: [String: CourseConfig] = [:]
    @Published private(set) var available: [AvailableCourse] = []
    @Published var courseFilter = ""

    @Published private(set) var busy: String?
    @Published private(set) var error: String?
    @Published private(set) var notice: String?
    @Published private(set) var loaded = false

    private var savedPayload: SavePayload?

    var credentials: Credentials {
        Credentials(baseUrl: baseUrl, username: username, password: password.isEmpty ? nil : password)
    }

    var payload: SavePayload {
        SavePayload(
            baseUrl: baseUrl, username: username, password: password.isEmpty ? nil : password,
            intervalMinutes: intervalMinutes, baseDir: baseDir,
            courses: selected.values.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
        )
    }

    var isDirty: Bool { payload != savedPayload }

    /// Courses that are selected but no longer appear on the dashboard (e.g. after leaving them).
    var orphaned: [CourseConfig] {
        let ids = Set(available.map(\.refId))
        return selected.values.filter { !ids.contains($0.refId) }.sorted { $0.title < $1.title }
    }

    /// Groups in the order the background job sorted them (newest semester first).
    var groups: [(name: String, courses: [AvailableCourse])] {
        var order: [String] = []
        var byGroup: [String: [AvailableCourse]] = [:]
        for course in available {
            let name = course.groupLabel
            if byGroup[name] == nil { order.append(name) }
            byGroup[name, default: []].append(course)
        }
        return order.map { ($0, byGroup[$0]!) }
    }

    func load() async {
        await run("Loading…") {
            let config: ConfigResponse = try await DaemonClient.request("GET", "/api/config")
            if let url = config.baseUrl { self.baseUrl = url }
            self.username = config.username ?? ""
            self.hasPassword = config.hasPassword
            self.intervalMinutes = Int(config.intervalMinutes ?? 30)
            if let dir = config.baseDir {
                self.baseDir = dir
            } else if let first = config.courses?.first {
                self.baseDir = (first.targetDir as NSString).deletingLastPathComponent
            }
            self.selected = Dictionary(uniqueKeysWithValues: (config.courses ?? []).map { ($0.refId, $0) })
            self.password = ""
            self.savedPayload = self.payload
            self.loaded = true
        }
        if hasPassword && !username.isEmpty { await loadCourses() }
    }

    func testLogin() async {
        await run("Logging in…") {
            let _: OkResponse = try await DaemonClient.request("POST", "/api/test-login", body: self.credentials)
            self.notice = "Login successful."
        }
    }

    func loadCourses() async {
        await run("Loading courses from ILIAS…") {
            self.available = try await DaemonClient.request("POST", "/api/courses", body: self.credentials)
        }
    }

    func save(onSaved: () -> Void) async {
        var ok = false
        await run(password.isEmpty ? "Saving…" : "Checking login and saving…") {
            let _: OkResponse = try await DaemonClient.request("PUT", "/api/config", body: self.payload)
            if !self.password.isEmpty { self.hasPassword = true }
            self.password = ""
            self.savedPayload = self.payload
            self.notice = "Saved. Syncing now."
            ok = true
        }
        if ok { onSaved() }
    }

    func setSelected(_ course: AvailableCourse, _ on: Bool) {
        if on {
            selected[course.refId] = CourseConfig(
                refId: course.refId, title: course.title,
                targetDir: (baseDir as NSString).appendingPathComponent(course.folderName),
                videos: false
            )
        } else {
            selected[course.refId] = nil
        }
    }

    func chooseBaseDir() {
        if let path = Self.pickFolder(startingAt: baseDir) { baseDir = path }
    }

    func chooseFolder(for refId: String) {
        guard let current = selected[refId] else { return }
        if let path = Self.pickFolder(startingAt: current.targetDir) { selected[refId]?.targetDir = path }
    }

    private func run(_ label: String, _ work: @escaping () async throws -> Void) async {
        busy = label
        error = nil
        notice = nil
        do {
            try await work()
        } catch {
            self.error = error.localizedDescription
        }
        busy = nil
    }

    private static func pickFolder(startingAt path: String) -> String? {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Choose"
        var dir = URL(fileURLWithPath: path)
        while !FileManager.default.fileExists(atPath: dir.path) && dir.path != "/" { dir.deleteLastPathComponent() }
        panel.directoryURL = dir
        return panel.runModal() == .OK ? panel.url?.path : nil
    }
}
