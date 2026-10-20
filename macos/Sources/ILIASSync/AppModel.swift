import AppKit
import Foundation

/// Polls the background job for its status and forwards menu actions to it.
@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var status: DaemonStatus?
    @Published private(set) var error: String?

    private var timer: Timer?

    init() {
        Task { await refresh() }
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            Task { await self?.refresh() }
        }
    }

    var isPaused: Bool { status?.state == "paused" }
    var isRunning: Bool { status != nil }

    var iconName: String {
        guard let status else { return "graduationcap.circle" }
        switch status.state {
        case "syncing": return "arrow.triangle.2.circlepath"
        case "paused": return "pause.circle"
        case "error", "needs-setup": return "exclamationmark.triangle"
        default: return "graduationcap"
        }
    }

    var headline: String {
        guard let status else { return error ?? "Connecting…" }
        switch status.state {
        case "syncing": return "Syncing…"
        case "paused": return "Paused"
        case "needs-setup": return "Setup needed: open Settings"
        case "error": return "⚠︎ Last sync failed"
        default:
            guard let run = status.lastRun, let date = ISODate.parse(run.finishedAt) else { return "Waiting for first sync" }
            let changes = run.added + run.updated
            let summary = changes == 0 ? "nothing new" : "\(changes) new/updated"
            return "✓ Last sync \(Self.time(date)) · \(summary)"
        }
    }

    var nextRunText: String? {
        ISODate.parse(status?.nextRun).map { "Next check at \(Self.time($0))" }
    }

    func refresh() async {
        do {
            status = try await DaemonClient.request("GET", "/api/status")
            error = nil
        } catch {
            status = nil
            self.error = error.localizedDescription
        }
    }

    func syncNow() { send("/api/sync") }
    func togglePause() { send(isPaused ? "/api/resume" : "/api/pause") }

    func startBackgroundJob() {
        DaemonClient.restartBackgroundJob()
        Task {
            try? await Task.sleep(for: .seconds(2))
            await refresh()
        }
    }

    private func send(_ path: String) {
        Task {
            do {
                status = try await DaemonClient.request("POST", path)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    private static func time(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = Calendar.current.isDateInToday(date) ? "HH:mm" : "E HH:mm"
        return formatter.string(from: date)
    }
}
