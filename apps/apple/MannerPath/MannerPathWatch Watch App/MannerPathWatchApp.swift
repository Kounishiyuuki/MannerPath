//
//  MannerPathWatchApp.swift
//  MannerPathWatch Watch App
//
//  Created by yuuki kounishi on 2026/09/20.
//

import Foundation
import SwiftUI

@main
struct MannerPathWatch_Watch_AppApp: App {
    init() {
        #if DEBUG
        let process = ProcessInfo.processInfo
        if process.arguments.contains("--mannerpath-watch-ui-test"),
           process.environment["MANNERPATH_WATCH_UI_TEST_SCENARIO"] != nil {
            UserDefaults.standard.set(process.environment["MANNERPATH_WATCH_UI_TEST_ELIGIBLE"] == "yes",
                                      forKey: "watchEligibilityNoticeAccepted")
        }
        #endif
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
