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

    // Capacitor's stock CapacitorRouter answers EVERY extension-less path with
    // index.html. Next's static export writes each route as a file —
    // out/trip/phase/loading/step/1-linehaul.html — while the app addresses it by its
    // clean URL, so under that rule any reload of any screen but Home is served Home's
    // document. The WebView does that reload by itself: when iOS reclaims the WKWebView
    // content process (the driver is in the native document scanner, with a scan, a
    // pdf-lib build and two uploads in memory), Capacitor's
    // webViewWebContentProcessDidTerminate() calls reload() on the CURRENT url. The
    // driver then stood on Home's page under the step's URL, with no tab bar and no way
    // back — see lib/navigation/document-url-mismatch.ts for the web half of this.
    //
    // Resolving the route's real exported file first puts the reload back on the screen
    // the driver was actually on. index.html stays the fallback, so a genuine SPA route
    // with no file of its own behaves exactly as Capacitor intends.
    private struct ExportedPageRouter: Router {
        var basePath: String = ""

        func route(for path: String) -> String {
            // A path with an extension is an asset request; never rewrite those.
            guard URL(fileURLWithPath: path).pathExtension.isEmpty else {
                return basePath + path
            }
            // Both shapes Next can emit, so this keeps working if `trailingSlash` is
            // ever turned on in next.config.ts.
            for candidate in [basePath + path + ".html", basePath + path + "/index.html"]
            where FileManager.default.fileExists(atPath: candidate) {
                return candidate
            }
            return basePath + "/index.html"
        }
    }

    override func router() -> Router {
        return ExportedPageRouter()
    }

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
