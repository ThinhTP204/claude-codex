// Minimal native macOS window for AgentDesk: a WKWebView pointed at the local server.
// Built on first launch by bin/agentdesk.js:  swiftc -O native/AgentDeskWindow.swift -o ~/.agentdesk/bin/AgentDeskWindow
// Usage: AgentDeskWindow <url>        (started by `agentdesk`, the server already runs)
//        AgentDesk.app                 (packaged: starts the bundled server itself, see scripts/package-mac.sh)
import AppKit
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var titleObservation: NSKeyValueObservation?
    let url: URL?
    /** the bundled Node server, when running as AgentDesk.app */
    var server: Process?

    init(url: URL?) {
        self.url = url
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let icon = Self.makeIcon() { NSApp.applicationIconImage = icon }
        buildMenu()

        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        webView = WKWebView(frame: .zero, configuration: config)
        webView.uiDelegate = self
        webView.navigationDelegate = self
        if #available(macOS 13.3, *) { webView.isInspectable = true }
        webView.setValue(false, forKey: "drawsBackground")

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1500, height: 940),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "AgentDesk"
        window.tabbingMode = .disallowed
        window.minSize = NSSize(width: 900, height: 560)
        window.contentView = webView
        window.center()
        window.setFrameAutosaveName("AgentDeskMainWindow")
        window.makeKeyAndOrderFront(nil)

        titleObservation = webView.observe(\.title, options: [.new]) { [weak self] wv, _ in
            if let t = wv.title, !t.isEmpty { self?.window.title = t }
        }
        if let url { webView.load(URLRequest(url: url)) } else { startBundledServer() }
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) {
        server?.terminate()
    }

    // MARK: packaged app: Contents/Resources/{node, app/bin/agentdesk.js}
    func startBundledServer() {
        showMessage("Đang khởi động AgentDesk…", detail: "")
        guard let res = Bundle.main.resourceURL else { return }
        let node = res.appendingPathComponent("node")
        let script = res.appendingPathComponent("app/bin/agentdesk.js")
        let p = Process()
        p.executableURL = node
        p.arguments = [script.path, "--no-open"]
        p.currentDirectoryURL = FileManager.default.homeDirectoryForCurrentUser
        var env = ProcessInfo.processInfo.environment
        env["AGENTDESK_PACKAGED"] = "1"
        env["AGENTDESK_HOST"] = "mac-app"
        p.environment = env
        let out = Pipe()
        p.standardOutput = out
        p.standardError = out
        var log = ""
        out.fileHandleForReading.readabilityHandler = { [weak self] h in
            let data = h.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            log = String((log + text).suffix(4000))
            // the launcher prints "AgentDesk đang chạy: <url>" once the server listens
            if let r = text.range(of: #"https?://\S+"#, options: .regularExpression), text.contains("AgentDesk") {
                let u = URL(string: String(text[r]))
                DispatchQueue.main.async { if let u { self?.webView.load(URLRequest(url: u)) } }
            }
        }
        p.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async {
                guard NSApp.isRunning else { return }
                // 75 = the in-app updater installed new code: start it
                if proc.terminationStatus == 75 { self?.startBundledServer(); return }
                self?.showMessage("AgentDesk đã dừng (mã \(proc.terminationStatus)).", detail: log)
            }
        }
        do {
            try p.run()
            server = p
        } catch {
            showMessage("Không khởi động được server.", detail: error.localizedDescription)
        }
    }

    func showMessage(_ title: String, detail: String) {
        let esc = { (s: String) in s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;") }
        let html = """
        <html><body style="font:14px -apple-system;color:#8a8778;background:#1f1e1c;display:grid;place-items:center;height:100vh;margin:0">
        <div style="max-width:680px;text-align:center"><div style="font-size:16px;color:#e8e6e1">\(esc(title))</div>
        <pre style="text-align:left;white-space:pre-wrap;font:11px Menlo;margin-top:14px">\(esc(detail))</pre></div></body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    // MARK: menus (the Edit menu is what makes ⌘C / ⌘V / ⌘A work inside the web view)
    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Ẩn AgentDesk", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Thoát AgentDesk", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        main.addItem(appItem)

        let fileItem = NSMenuItem()
        let file = NSMenu(title: "File")
        file.addItem(withTitle: "Cuộc trò chuyện mới", action: #selector(newChat), keyEquivalent: "n").target = self
        file.addItem(withTitle: "Mở project…", action: #selector(openProject), keyEquivalent: "o").target = self
        fileItem.submenu = file
        main.addItem(fileItem)

        let editItem = NSMenuItem()
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        main.addItem(editItem)

        let viewItem = NSMenuItem()
        let view = NSMenu(title: "View")
        view.addItem(withTitle: "Tải lại", action: #selector(reload), keyEquivalent: "r").target = self
        view.addItem(withTitle: "Phóng to", action: #selector(zoomIn), keyEquivalent: "+").target = self
        view.addItem(withTitle: "Thu nhỏ", action: #selector(zoomOut), keyEquivalent: "-").target = self
        view.addItem(withTitle: "Cỡ thật", action: #selector(zoomReset), keyEquivalent: "0").target = self
        viewItem.submenu = view
        main.addItem(viewItem)

        let winItem = NSMenuItem()
        let win = NSMenu(title: "Window")
        win.addItem(withTitle: "Thu nhỏ", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: "Đóng", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        winItem.submenu = win
        main.addItem(winItem)
        NSApp.mainMenu = main
    }

    @objc func reload() { webView.reload() }
    @objc func newChat() { webView.evaluateJavaScript("window.agentdesk?.newConv()") }
    @objc func openProject() { webView.evaluateJavaScript("window.agentdesk?.pickProject()") }
    @objc func zoomIn() { webView.pageZoom = min(2.0, webView.pageZoom + 0.1) }
    @objc func zoomOut() { webView.pageZoom = max(0.5, webView.pageZoom - 0.1) }
    @objc func zoomReset() { webView.pageZoom = 1.0 }

    // MARK: links: anything leaving the local server opens in the default browser
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let u = action.request.url, let host = u.host, !["localhost", "127.0.0.1", "::1"].contains(host), u.scheme?.hasPrefix("http") == true {
            NSWorkspace.shared.open(u)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = action.request.url { NSWorkspace.shared.open(u) }
        return nil
    }

    // MARK: JS dialogs (alert / confirm / prompt are silent in WKWebView unless handled)
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert()
        a.messageText = message
        a.addButton(withTitle: "OK")
        a.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert()
        a.messageText = message
        a.addButton(withTitle: "OK")
        a.addButton(withTitle: "Huỷ")
        a.beginSheetModal(for: window) { r in completionHandler(r == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let a = NSAlert()
        a.messageText = prompt
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        field.stringValue = defaultText ?? ""
        a.accessoryView = field
        a.addButton(withTitle: "OK")
        a.addButton(withTitle: "Huỷ")
        a.window.initialFirstResponder = field
        a.beginSheetModal(for: window) { r in completionHandler(r == .alertFirstButtonReturn ? field.stringValue : nil) }
    }

    /** Dock icon (docs/logo.svg): AgentDesk.icns inside the .app, else AgentDesk.png next to the binary (dev build). */
    static func makeIcon() -> NSImage? {
        if let icon = Bundle.main.image(forResource: "AgentDesk") { return icon }
        let png = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath().deletingLastPathComponent().appendingPathComponent("AgentDesk.png")
        return NSImage(contentsOf: png)
    }
}

let args = CommandLine.arguments
// no URL: running as AgentDesk.app, start the bundled server
let url = args.count > 1 ? URL(string: args[1]) : nil

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate(url: url)
app.delegate = delegate
app.run()
