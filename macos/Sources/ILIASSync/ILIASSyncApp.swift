import SwiftUI

@main
struct ILIASSyncApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        MenuBarExtra {
            MenuContent(model: model)
        } label: {
            Image(systemName: model.iconName)
        }
        .menuBarExtraStyle(.menu)

        Window("ILIAS Sync Settings", id: "settings") {
            SettingsView(onSaved: { Task { await model.refresh() } })
        }
        .windowResizability(.contentSize)
        .defaultLaunchBehavior(.suppressed)
    }
}
