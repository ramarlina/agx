import Foundation

struct Host: Identifiable, Codable, Hashable {
    var id: UUID = UUID()
    var name: String
    var url: String
    var lastUsed: Date? = nil
}

@MainActor
final class HostStore: ObservableObject {
    @Published private(set) var hosts: [Host] = []
    private let key = "agx.hosts.v1"
    private let defaults = UserDefaults.standard

    init() { load() }

    var sorted: [Host] {
        hosts.sorted { ($0.lastUsed ?? .distantPast) > ($1.lastUsed ?? .distantPast) }
    }

    func upsert(_ host: Host) {
        if let i = hosts.firstIndex(where: { $0.id == host.id }) { hosts[i] = host }
        else { hosts.append(host) }
        save()
    }

    func delete(id: UUID) {
        hosts.removeAll { $0.id == id }
        save()
    }

    func touch(id: UUID) {
        guard let i = hosts.firstIndex(where: { $0.id == id }) else { return }
        hosts[i].lastUsed = Date()
        save()
    }

    private func load() {
        guard let data = defaults.data(forKey: key),
              let decoded = try? JSONDecoder().decode([Host].self, from: data) else { return }
        hosts = decoded
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(hosts) else { return }
        defaults.set(data, forKey: key)
    }
}
