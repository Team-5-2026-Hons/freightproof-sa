import UIKit
import Capacitor

// Capacitor's bridge view controller, with two fixes: it turns off the iOS 26 scroll-edge
// effect that frosts the status bar, and it routes reloads to the screen's real exported
// page instead of Home. Main.storyboard names this class instead of CAPBridgeViewController.

class MainViewController: CAPBridgeViewController {

    /// Resolves a clean URL to its static-export file, falling back to index.html.
    private struct ExportedPageRouter: Router {
        var basePath: String = ""

        func route(for path: String) -> String {
            guard URL(fileURLWithPath: path).pathExtension.isEmpty else {
                return basePath + path
            }
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
