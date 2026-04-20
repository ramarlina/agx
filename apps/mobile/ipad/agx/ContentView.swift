import SwiftUI

struct ContentView: View {
    @EnvironmentObject var store: HostStore
    @State private var selection: Host.ID?
    @State private var editing: HostEditTarget?

    var body: some View {
        NavigationSplitView {
            sidebar
        } detail: {
            detail
        }
        .sheet(item: $editing) { target in
            HostEditView(target: target) { updated in
                store.upsert(updated)
                editing = nil
            } onCancel: { editing = nil }
        }
    }

    private var sidebar: some View {
        List(selection: $selection) {
            ForEach(store.sorted) { host in
                HostRow(host: host)
                    .tag(host.id)
                    .swipeActions {
                        Button(role: .destructive) { store.delete(id: host.id) } label: { Label("Delete", systemImage: "trash") }
                        Button { editing = .edit(host) } label: { Label("Edit", systemImage: "pencil") }.tint(.blue)
                    }
                    .contextMenu {
                        Button("Edit") { editing = .edit(host) }
                        Button("Delete", role: .destructive) { store.delete(id: host.id) }
                    }
            }
        }
        .listStyle(.sidebar)
        .navigationTitle("agx")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { editing = .new } label: { Image(systemName: "plus") }
            }
        }
        .overlay {
            if store.hosts.isEmpty {
                VStack(spacing: 12) {
                    Text("No hosts yet").font(.title3)
                    Button("+ Add your first agx") { editing = .new }
                        .buttonStyle(.borderedProminent)
                }
            }
        }
    }

    @ViewBuilder
    private var detail: some View {
        if let id = selection, let host = store.hosts.first(where: { $0.id == id }) {
            WebPane(host: host)
                .id(host.id)
                .onAppear { store.touch(id: host.id) }
        } else {
            ContentUnavailableView("Select a host", systemImage: "globe", description: Text("Pick a connection from the sidebar."))
        }
    }
}

struct HostRow: View {
    let host: Host
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(host.name).font(.body).fontWeight(.medium)
            Text(host.url).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            Text(lastUsedLabel).font(.caption2).foregroundStyle(.tertiary)
        }
        .padding(.vertical, 2)
    }

    private var lastUsedLabel: String {
        guard let d = host.lastUsed else { return "never used" }
        let f = RelativeDateTimeFormatter()
        return "last used " + f.localizedString(for: d, relativeTo: Date())
    }
}

struct WebPane: View {
    let host: Host
    @State private var reloadToken = 0
    @State private var error: String?

    var body: some View {
        ZStack(alignment: .top) {
            if let url = URL(string: host.url) {
                WebView(url: url, reloadToken: $reloadToken) { msg in error = msg }
                    .ignoresSafeArea(edges: .bottom)
            } else {
                ContentUnavailableView("Invalid URL", systemImage: "exclamationmark.triangle")
            }
            if let err = error {
                HStack {
                    Text(err).font(.callout)
                    Spacer()
                    Button("Retry") { error = nil; reloadToken += 1 }
                }
                .padding(12)
                .background(.red.opacity(0.15))
            }
        }
        .navigationTitle(host.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { error = nil; reloadToken += 1 } label: { Image(systemName: "arrow.clockwise") }
            }
        }
    }
}

enum HostEditTarget: Identifiable {
    case new, edit(Host)
    var id: String {
        switch self {
        case .new: return "new"
        case .edit(let h): return h.id.uuidString
        }
    }
}

struct HostEditView: View {
    let target: HostEditTarget
    var onSave: (Host) -> Void
    var onCancel: () -> Void
    @State private var name = ""
    @State private var url = "https://"

    private var existing: Host? {
        if case .edit(let h) = target { return h } else { return nil }
    }
    private var canSave: Bool { !name.trimmingCharacters(in: .whitespaces).isEmpty && url.hasPrefix("http") }

    var body: some View {
        NavigationStack {
            Form {
                Section("Name") { TextField("Home desktop", text: $name).autocorrectionDisabled() }
                Section("URL") {
                    TextField("https://machine.tail-xxxx.ts.net", text: $url)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                }
            }
            .navigationTitle(existing == nil ? "Add connection" : "Edit connection")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: onCancel) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        var h = existing ?? Host(name: "", url: "")
                        h.name = name
                        h.url = url
                        onSave(h)
                    }.disabled(!canSave)
                }
            }
            .onAppear {
                if let h = existing { name = h.name; url = h.url }
            }
        }
    }
}
