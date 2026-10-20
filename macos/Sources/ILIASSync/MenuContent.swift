import AppKit
import SwiftUI

struct MenuContent: View {
    @ObservedObject var model: AppModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Text(model.headline)
        if let message = model.status?.message {
            Text(message)
        }
        if let next = model.nextRunText {
            Text(next)
        }

        if !model.isRunning {
            Divider()
            Button("Start Background Sync") { model.startBackgroundJob() }
        }

        if let recent = model.status?.recent, !recent.isEmpty {
            Divider()
            Section("Recent Files") {
                ForEach(recent.prefix(8)) { file in
                    Button((file.updated ? "↻ " : "") + file.label) {
                        NSWorkspace.shared.open(URL(fileURLWithPath: file.path))
                    }
                }
            }
        }

        Divider()
        Button("Sync Now") { model.syncNow() }
            .keyboardShortcut("s")
            .disabled(!model.isRunning || model.status?.state == "syncing")
        Button(model.isPaused ? "Resume" : "Pause") { model.togglePause() }
            .disabled(!model.isRunning)

        if let courses = model.status?.courses, !courses.isEmpty {
            Menu("Open Course Folder") {
                ForEach(courses, id: \.self) { course in
                    Button(course.title) {
                        NSWorkspace.shared.open(URL(fileURLWithPath: course.targetDir))
                    }
                }
            }
        }
        Button("Show Log") { NSWorkspace.shared.open(DaemonClient.logFile) }

        Divider()
        Button("Settings…") {
            openWindow(id: "settings")
            NSApp.activate()
        }
        .keyboardShortcut(",")
        Button("Quit Menu Bar App") { NSApp.terminate(nil) }
            .keyboardShortcut("q")
    }
}
