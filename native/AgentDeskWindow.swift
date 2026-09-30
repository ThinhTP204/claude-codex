// Minimal native macOS window for AgentDesk: a WKWebView pointed at the local server.
// Built on first launch by bin/agentdesk.js:  swiftc -O native/AgentDeskWindow.swift -o ~/.agentdesk/bin/AgentDeskWindow
// Usage: AgentDeskWindow <url>
import AppKit
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var titleObservation: NSKeyValueObservation?
    let url: URL

    init(url: URL) {
        self.url = url
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.applicationIconImage = Self.makeIcon()
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
        webView.load(URLRequest(url: url))
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

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
        if let u = action.request.url, let host = u.host, host != url.host, u.scheme?.hasPrefix("http") == true {
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

    /** Dock icon: the AgentDesk mark (docs/logo.svg) drawn on its 128-unit grid. */
    static func makeIcon() -> NSImage {
        let size = NSSize(width: 512, height: 512)
        let img = NSImage(size: size)
        img.lockFocus()
        // macOS icons keep a margin around the tile; the SVG's y axis points down
        let inset: CGFloat = 40, k = (512 - 2 * inset) / 128
        func r(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> NSRect {
            NSRect(x: inset + x * k, y: inset + (128 - y - h) * k, width: w * k, height: h * k)
        }
        func p(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: inset + x * k, y: inset + (128 - y) * k) }
        func color(_ hex: Int) -> NSColor {
            NSColor(red: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: 1)
        }
        color(0x1f1e1c).setFill()
        NSBezierPath(roundedRect: r(0, 0, 128, 128), xRadius: 28 * k, yRadius: 28 * k).fill()
        let links = NSBezierPath()
        links.lineWidth = 3.5 * k
        links.lineCapStyle = .round
        links.move(to: p(84, 42))
        links.curve(to: p(98, 54), controlPoint1: p(93, 42), controlPoint2: p(98, 46))
        links.move(to: p(44, 86))
        links.curve(to: p(30, 74), controlPoint1: p(35, 86), controlPoint2: p(30, 82))
        color(0x5a5750).setStroke()
        links.stroke()
        for (x, y, hex) in [(30.0, 34.0, 0xD97757), (46.0, 56.0, 0x10A37F), (30.0, 78.0, 0x8f8a80)] {
            color(hex).setFill()
            NSBezierPath(roundedRect: r(CGFloat(x), CGFloat(y), 52, 16), xRadius: 8 * k, yRadius: 8 * k).fill()
        }
        img.unlockFocus()
        return img
    }
}

guard CommandLine.arguments.count > 1, let url = URL(string: CommandLine.arguments[1]) else {
    FileHandle.standardError.write("usage: AgentDeskWindow <url>\n".data(using: .utf8)!)
    exit(2)
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate(url: url)
app.delegate = delegate
app.run()
