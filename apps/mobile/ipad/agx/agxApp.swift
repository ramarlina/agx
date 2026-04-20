import SwiftUI

@main
struct agxApp: App {
    @StateObject private var store = HostStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
        }
    }
}
