import AppKit
import SwiftUI

struct SettingsView: View {
    var onSaved: () -> Void
    @StateObject private var model = SettingsModel()

    var body: some View {
        VStack(spacing: 0) {
            TabView {
                AccountTab(model: model)
                    .tabItem { Label("Account", systemImage: "person.crop.circle") }
                CoursesTab(model: model)
                    .tabItem { Label("Courses", systemImage: "books.vertical") }
                GeneralTab(model: model)
                    .tabItem { Label("General", systemImage: "gearshape") }
            }
            .padding([.horizontal, .top])

            Divider().padding(.top, 8)
            HStack {
                if let busy = model.busy {
                    ProgressView().controlSize(.small)
                    Text(busy).foregroundStyle(.secondary)
                } else if let error = model.error {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                        .lineLimit(2)
                } else if let notice = model.notice {
                    Label(notice, systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                }
                Spacer()
                Button("Save") { Task { await model.save(onSaved: onSaved) } }
                    .keyboardShortcut(.defaultAction)
                    .disabled(!model.isDirty || model.busy != nil || model.username.isEmpty)
            }
            .padding()
        }
        .frame(width: 680, height: 540)
        .task { await model.load() }
    }
}

private struct AccountTab: View {
    @ObservedObject var model: SettingsModel

    var body: some View {
        Form {
            Section {
                TextField("ILIAS URL", text: $model.baseUrl)
                TextField("Username", text: $model.username)
                SecureField("Password", text: $model.password,
                            prompt: Text(model.hasPassword ? "Stored in Keychain (leave empty to keep)" : "Required"))
            } footer: {
                Text("Your password is stored in the macOS Keychain, never in a file.")
                    .foregroundStyle(.secondary)
            }
            HStack {
                Spacer()
                Button("Test Login") { Task { await model.testLogin() } }
                    .disabled(model.busy != nil || model.username.isEmpty || (!model.hasPassword && model.password.isEmpty))
            }
        }
        .formStyle(.grouped)
    }
}

private struct CoursesTab: View {
    @ObservedObject var model: SettingsModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                TextField("Filter", text: $model.courseFilter).textFieldStyle(.roundedBorder).frame(maxWidth: 240)
                Spacer()
                Text("\(model.selected.count) selected").foregroundStyle(.secondary)
                Button("Reload from ILIAS") { Task { await model.loadCourses() } }
                    .disabled(model.busy != nil || model.username.isEmpty)
            }

            if model.available.isEmpty && model.orphaned.isEmpty {
                ContentUnavailableView(
                    "No courses loaded",
                    systemImage: "books.vertical",
                    description: Text("Enter your account on the Account tab, then click “Reload from ILIAS”.")
                )
            } else {
                List {
                    ForEach(model.groups, id: \.name) { group in
                        let courses = group.courses.filter(matches)
                        if !courses.isEmpty {
                            Section(group.name) {
                                ForEach(courses) { course in
                                    CourseRow(model: model, refId: course.refId, title: course.title, available: course)
                                }
                            }
                        }
                    }
                    if !model.orphaned.isEmpty {
                        Section("No longer on your dashboard") {
                            ForEach(model.orphaned) { course in
                                CourseRow(model: model, refId: course.refId, title: course.title, available: nil)
                            }
                        }
                    }
                }
                .listStyle(.inset(alternatesRowBackgrounds: true))
            }
        }
    }

    private func matches(_ course: AvailableCourse) -> Bool {
        model.courseFilter.isEmpty || course.title.localizedCaseInsensitiveContains(model.courseFilter) || model.selected[course.refId] != nil
    }
}

private struct CourseRow: View {
    @ObservedObject var model: SettingsModel
    let refId: String
    let title: String
    let available: AvailableCourse?

    var body: some View {
        let config = model.selected[refId]
        VStack(alignment: .leading, spacing: 4) {
            Toggle(isOn: Binding(
                get: { config != nil },
                set: { on in
                    if let available { model.setSelected(available, on) } else if !on { model.selected[refId] = nil }
                }
            )) {
                Text(title).fontWeight(config != nil ? .medium : .regular)
            }
            if let config {
                HStack(spacing: 8) {
                    Image(systemName: "folder").foregroundStyle(.secondary)
                    Text(config.targetDir)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Button("Change…") { model.chooseFolder(for: refId) }
                        .controlSize(.small)
                    Spacer()
                    Toggle("Recordings (~500 MB each)", isOn: Binding(
                        get: { config.videos },
                        set: { model.selected[refId]?.videos = $0 }
                    ))
                    .toggleStyle(.checkbox)
                    .font(.caption)
                }
                .padding(.leading, 20)
            }
        }
        .padding(.vertical, 2)
    }
}

private struct GeneralTab: View {
    @ObservedObject var model: SettingsModel

    var body: some View {
        Form {
            Section {
                Picker("Check for new files every", selection: $model.intervalMinutes) {
                    ForEach([15, 30, 60, 120, 240], id: \.self) { minutes in
                        Text(minutes < 60 ? "\(minutes) minutes" : "\(minutes / 60) hour\(minutes > 60 ? "s" : "")").tag(minutes)
                    }
                }
                LabeledContent("Default folder for new courses") {
                    HStack {
                        Text(model.baseDir).lineLimit(1).truncationMode(.middle).foregroundStyle(.secondary)
                        Button("Choose…") { model.chooseBaseDir() }
                    }
                }
            } footer: {
                Text("A sync also runs right after your Mac wakes up.").foregroundStyle(.secondary)
            }
            Section {
                HStack {
                    Button("Show Log") { NSWorkspace.shared.open(DaemonClient.logFile) }
                    Button("Open Config Folder") { NSWorkspace.shared.open(DaemonClient.configDir) }
                }
            }
        }
        .formStyle(.grouped)
    }
}
