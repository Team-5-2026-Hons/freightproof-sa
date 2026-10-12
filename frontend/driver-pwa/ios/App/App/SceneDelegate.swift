import UIKit
import Capacitor

// Required since the iOS 26/27 SDK: an app built against it must adopt the UIScene life
// cycle or it is refused at launch ("UIScene life cycle is required for apps built with
// this SDK" — a black screen). The Capacitor 6 template only had an AppDelegate.
//
// The window and its root view controller (Capacitor's bridge view controller) still come
// from Main.storyboard — Info.plist's UISceneStoryboardFile tells UIKit to build them for
// this scene — so the web app boots exactly as before. This class only has to forward the
// URL and Universal Link events that, under scenes, iOS delivers here instead of to the
// AppDelegate, so Capacitor's App plugin keeps seeing them.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard scene is UIWindowScene else { return }

        // A cold launch from a link arrives in the connection options, not in the
        // openURLContexts / continue callbacks below.
        if let urlContext = connectionOptions.urlContexts.first {
            forward(urlContext)
        }
        if let userActivity = connectionOptions.userActivities.first {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity) { _ in }
        }
    }

    // A custom-scheme URL opened while the app is already running.
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        URLContexts.forEach(forward)
    }

    // A Universal Link (or Handoff activity) while the app is already running.
    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity) { _ in }
    }

    private func forward(_ context: UIOpenURLContext) {
        var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
        if let source = context.options.sourceApplication {
            options[.sourceApplication] = source
        }
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: options)
    }
}
