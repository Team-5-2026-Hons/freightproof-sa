import UIKit
import Capacitor

// Capacitor's bridge view controller, with one fix for apps built against the iOS 26+ SDK.
//
// iOS 26 gives every UIScrollView an automatic "scroll edge effect": where content passes
// under the status bar, UIKit draws a frosted band tinted by the PHONE's appearance. The
// web view is one big scroll view whose page already runs under the status bar
// (viewportFit: 'cover' + .pt-safe), so the effect laid an opaque-looking white band over
// the top 47pt of every screen — in the app's dark theme too, because it follows the phone,
// not the page. Measured on device: the web view, the safe-area inset the page sees (47pt)
// and the viewport were all correct; only this effect was drawn on top.
//
// The page draws its own status-bar treatment, so the system effect is switched off on
// both edges (the bottom one would frost the area behind the home indicator the same way).
//
// Main.storyboard names this class instead of CAPBridgeViewController.
class MainViewController: CAPBridgeViewController {

    // The --fp-surface tokens in app/globals.css. Shown only for the instant before the
    // page's first paint, so a cold start never flashes system white under a dark app.
    private static let surfaceLight = UIColor(red: 252 / 255, green: 248 / 255, blue: 249 / 255, alpha: 1)
    private static let surfaceDark = UIColor(red: 18 / 255, green: 18 / 255, blue: 21 / 255, alpha: 1)

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        guard let webView = webView else { return }

        let surface = UIColor { traits in
            traits.userInterfaceStyle == .dark ? Self.surfaceDark : Self.surfaceLight
        }
        webView.backgroundColor = surface
        webView.scrollView.backgroundColor = surface

        if #available(iOS 26.0, *) {
            webView.scrollView.topEdgeEffect.isHidden = true
            webView.scrollView.bottomEdgeEffect.isHidden = true
        }
    }
}
