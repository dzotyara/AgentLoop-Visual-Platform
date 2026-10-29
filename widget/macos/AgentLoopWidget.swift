// AgentLoop desktop widget: a borderless SwiftUI panel that sits on the desktop (below app windows, like a
// macOS widget) and shows the pr-patrol loop live: rings, your PRs by number, a broken base.
// Built with swiftc only (no Xcode): see build.sh.
import AppKit
import SwiftUI

// MARK: - Config

struct Config {
    let api: URL
    let ui: URL
    let token: String
    let repoDir: URL
    let dailyBudget: Double

    static func load() -> Config {
        let env = ProcessInfo.processInfo.environment
        let dir = URL(fileURLWithPath: env["AGENTLOOP_DIR"] ?? NSHomeDirectory() + "/Projects/pr-loop")
        var file: [String: String] = [:]
        if let text = try? String(contentsOf: dir.appendingPathComponent(".env"), encoding: .utf8) {
            for line in text.split(separator: "\n") {
                let t = line.trimmingCharacters(in: .whitespaces)
                guard !t.hasPrefix("#"), let eq = t.firstIndex(of: "=") else { continue }
                let key = String(t[..<eq]).trimmingCharacters(in: .whitespaces)
                let value = String(t[t.index(after: eq)...]).trimmingCharacters(in: .whitespaces)
                    .trimmingCharacters(in: CharacterSet(charactersIn: "\""))
                file[key] = value
            }
        }
        let port = env["AGENTLOOP_PORT"] ?? file["PORT"] ?? "8790"
        return Config(
            api: URL(string: env["AGENTLOOP_URL"] ?? "http://127.0.0.1:\(port)")!,
            ui: URL(string: env["AGENTLOOP_UI"] ?? "http://127.0.0.1:8800")!,
            token: env["AGENTLOOP_TOKEN"] ?? file["API_AUTH_TOKEN"] ?? "",
            repoDir: dir,
            dailyBudget: Double(env["AGENTLOOP_WIDGET_DAILY_BUDGET"] ?? file["AGENTLOOP_WIDGET_DAILY_BUDGET"] ?? "") ?? 300
        )
    }
}

// MARK: - API models (only the fields the widget reads)

struct PatrolStatus: Decodable {
    struct Tick: Decodable { let at: Double; let error: String? }
    struct Run: Decodable { let agentId: String; let agentName: String; let action: String; let activity: String }
    let lastTick: Tick
    let maxConcurrent: Int
    let running: [String: Run]
    let crew: [String: String]?
    let baseBreaks: [BaseBreak]?
    let prs: [Pr]
}

struct BaseBreak: Decodable, Identifiable {
    let id: String
    let repo: String
    let base: String
    let checks: [String]
    let prs: [String]
    let status: String
    let fixPr: Int?
    let fixUrl: String?
}

struct Pr: Decodable, Identifiable {
    struct Check: Decodable { let state: String; let ignored: Bool? }
    struct Queue: Decodable { let position: Int? }
    struct Snapshot: Decodable { let checks: [Check]?; let mergeQueue: Queue? }
    struct AgentRef: Decodable { let name: String; let action: String; let activity: String }
    let pr_key: String
    let repo: String
    let number: Int
    let title: String
    let url: String
    let phase: String
    let summary: String
    let waiting_on: String?
    let snapshot: Snapshot?
    let agent: AgentRef?
    var id: String { pr_key }
}

struct CostsResponse: Decodable {
    struct Bucket: Decodable { let costUsd: Double; let runs: Int }
    let today: Bucket
}

// MARK: - Model

@MainActor
final class WidgetModel: ObservableObject {
    @Published var status: PatrolStatus?
    @Published var spendToday: Double?
    @Published var error: String?
    @Published var ticking = false
    let cfg = Config.load()
    var onChange: (() -> Void)?
    private var timer: Timer?

    func start() {
        Task { await refresh() }
        timer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
            Task { await self?.refresh() }
        }
    }

    private func get<T: Decodable>(_ path: String, as: T.Type) async throws -> T {
        var req = URLRequest(url: cfg.api.appendingPathComponent(path), timeoutInterval: 10)
        if !cfg.token.isEmpty { req.setValue("Bearer \(cfg.token)", forHTTPHeaderField: "Authorization") }
        let (data, res) = try await URLSession.shared.data(for: req)
        if let http = res as? HTTPURLResponse, http.statusCode != 200 {
            throw NSError(domain: "AgentLoop", code: http.statusCode, userInfo: [
                NSLocalizedDescriptionKey: http.statusCode == 401 ? "token rejected" : "HTTP \(http.statusCode)",
            ])
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    func refresh() async {
        do {
            status = try await get("api/pr-patrol/status", as: PatrolStatus.self)
            error = nil
        } catch {
            self.error = (error as NSError).code == NSURLErrorCannotConnectToHost ? "AgentLoop is down" : error.localizedDescription
        }
        if let c = try? await get("api/claude-costs", as: CostsResponse.self) { spendToday = c.today.costUsd }
        onChange?()
    }

    func checkNow() {
        ticking = true
        Task {
            var req = URLRequest(url: cfg.api.appendingPathComponent("api/pr-patrol/tick"), timeoutInterval: 10)
            req.httpMethod = "POST"
            if !cfg.token.isEmpty { req.setValue("Bearer \(cfg.token)", forHTTPHeaderField: "Authorization") }
            _ = try? await URLSession.shared.data(for: req)
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            await refresh()
            ticking = false
        }
    }

    // Derived

    var openPrs: [Pr] { (status?.prs ?? []).filter { $0.phase != "skipped" } }
    func count(_ phase: String) -> Int { openPrs.filter { $0.phase == phase }.count }
    var runningCount: Int { status?.running.count ?? 0 }
}

// MARK: - Look

enum Palette {
    static let track = Color.white.opacity(0.12)
    static let text = Color.white.opacity(0.94)
    static let muted = Color.white.opacity(0.58)
    static let hairline = Color.white.opacity(0.09)
    static let red = Color(red: 0.90, green: 0.28, blue: 0.30)
    static let blue = Color(red: 0.31, green: 0.63, blue: 0.95)
    static let violet = Color(red: 0.61, green: 0.48, blue: 0.94)
    static let amber = Color(red: 0.96, green: 0.72, blue: 0.24)
    static let green = Color(red: 0.25, green: 0.70, blue: 0.50)
    static let gray = Color.white.opacity(0.42)

    static func phase(_ pr: Pr) -> Color {
        switch pr.phase {
        case "blocked", "error": return red
        case "working": return blue
        case "ready": return green
        case "merging": return violet
        case "waiting": return pr.waiting_on == "base" || pr.waiting_on == "retry" ? gray : amber
        default: return gray
        }
    }
}

let PHASE_ORDER = ["blocked", "error", "working", "waiting", "watching", "ready", "merging"]

struct Ring: View {
    let value: Double
    let color: Color
    let label: String
    let caption: String

    var body: some View {
        VStack(spacing: 5) {
            ZStack {
                Circle().stroke(Palette.track, lineWidth: 5)
                Circle()
                    .trim(from: 0, to: max(0.001, min(value, 1)))
                    .stroke(color, style: StrokeStyle(lineWidth: 5, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Text(label)
                    .font(.system(size: label.count > 3 ? 12 : 15, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(Palette.text)
            }
            .frame(width: 50, height: 50)
            Text(caption).font(.system(size: 10, weight: .medium)).foregroundStyle(Palette.muted)
        }
        .frame(maxWidth: .infinity)
    }
}

struct PrRow: View {
    let pr: Pr
    let open: (String) -> Void

    var right: String {
        switch pr.phase {
        case "working": return pr.agent?.name ?? "working"
        case "blocked": return "needs you"
        case "error": return "error"
        case "ready": return "ready"
        case "merging": return pr.snapshot?.mergeQueue?.position.map { "queue #\($0)" } ?? "queue"
        case "watching": return "queued"
        case "waiting":
            switch pr.waiting_on {
            case "base": return "base"
            case "retry": return "retry"
            case "reviewer": return "reviewer"
            default: return "CI"
            }
        default: return pr.phase
        }
    }

    var body: some View {
        Button { open(pr.url) } label: {
            HStack(spacing: 6) {
                Circle().fill(Palette.phase(pr)).frame(width: 6, height: 6)
                Text(verbatim: "#\(pr.number)").font(.system(size: 11, weight: .medium)).monospacedDigit()
                    .foregroundStyle(Palette.text)
                Spacer(minLength: 4)
                Text(right).font(.system(size: 10.5)).foregroundStyle(Palette.muted).lineLimit(1)
            }
            .padding(.vertical, 3)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("\(pr.title)\n\(pr.summary)")
    }
}

struct WidgetView: View {
    @ObservedObject var model: WidgetModel

    func open(_ url: String) { if let u = URL(string: url) { NSWorkspace.shared.open(u) } }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            rings
            if let breaks = model.status?.baseBreaks, !breaks.isEmpty { ForEach(breaks) { baseBanner($0) } }
            prList
            footer
        }
        .padding(14)
        .frame(width: 168)
    }

    var rings: some View {
        let open = max(model.openPrs.count, 1)
        let blocked = model.count("blocked") + model.count("error")
        let slots = max(model.status?.maxConcurrent ?? 8, 1)
        let spend = model.spendToday ?? 0
        return LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
            Ring(value: Double(blocked) / Double(open), color: Palette.red, label: "\(blocked)", caption: "Needs you")
            Ring(value: Double(model.runningCount) / Double(slots), color: Palette.blue,
                 label: "\(model.runningCount)/\(slots)", caption: "Agents")
            Ring(value: Double(model.count("merging")) / Double(open), color: Palette.violet,
                 label: "\(model.count("merging"))", caption: "In queue")
            Ring(value: spend / model.cfg.dailyBudget, color: Palette.amber,
                 label: "$\(Int(spend.rounded()))", caption: "Today")
        }
    }

    func baseBanner(_ b: BaseBreak) -> some View {
        Button { if let u = b.fixUrl { open(u) } } label: {
            HStack(spacing: 6) {
                Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 10)).foregroundStyle(Palette.amber)
                Text("\(b.base) broken").font(.system(size: 11, weight: .medium)).foregroundStyle(Palette.text)
                Spacer(minLength: 2)
                Text(b.fixPr.map { "fix #\($0)" } ?? "no fix").font(.system(size: 10.5)).foregroundStyle(Palette.muted)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: 9).fill(Color.white.opacity(0.07)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("\(b.repo):\(b.base): \(b.checks.joined(separator: ", ")) · holds \(b.prs.count) PR")
    }

    var prList: some View {
        let prs = model.openPrs.sorted {
            (PHASE_ORDER.firstIndex(of: $0.phase) ?? 99, $0.number) < (PHASE_ORDER.firstIndex(of: $1.phase) ?? 99, $1.number)
        }
        return VStack(alignment: .leading, spacing: 0) {
            if prs.isEmpty {
                Text(model.error ?? (model.status == nil ? "Loading…" : "No open PRs"))
                    .font(.system(size: 11)).foregroundStyle(model.error == nil ? Palette.muted : Palette.red)
                    .padding(.vertical, 4)
            }
            ForEach(Array(prs.prefix(8))) { pr in PrRow(pr: pr, open: open) }
            if prs.count > 8 {
                Text("+\(prs.count - 8) more").font(.system(size: 10.5)).foregroundStyle(Palette.muted).padding(.top, 3)
            }
        }
    }

    var footer: some View {
        HStack(spacing: 6) {
            if let err = model.error, !model.openPrs.isEmpty {
                Text(err).font(.system(size: 10)).foregroundStyle(Palette.red).lineLimit(1)
            } else if let at = model.status?.lastTick.at, at > 0 {
                Text(ago(at)).font(.system(size: 10)).foregroundStyle(Palette.muted)
            }
            Spacer()
            Button { model.checkNow() } label: {
                Image(systemName: "arrow.clockwise").rotationEffect(.degrees(model.ticking ? 180 : 0))
            }
            .help("Check now")
            Button { NSWorkspace.shared.open(model.cfg.ui) } label: { Image(systemName: "arrow.up.right") }
                .help("Open AgentLoop")
        }
        .buttonStyle(PillButton())
    }

    func ago(_ ms: Double) -> String {
        let s = Int(Date().timeIntervalSince1970 - ms / 1000)
        return s < 60 ? "\(max(s, 0))s ago" : s < 3600 ? "\(s / 60)m ago" : "\(s / 3600)h ago"
    }
}

struct PillButton: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(Palette.text)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Capsule().fill(Color.white.opacity(configuration.isPressed ? 0.2 : 0.1)))
    }
}

// MARK: - Window

struct GlassBackground: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let v = NSVisualEffectView()
        v.material = .hudWindow
        v.blendingMode = .behindWindow
        v.state = .active
        return v
    }
    func updateNSView(_ v: NSVisualEffectView, context: Context) {}
}

final class WidgetPanel: NSPanel {
    override var canBecomeKey: Bool { true }
}

@main
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    var panel: WidgetPanel!
    var hosting: NSHostingView<AnyView>!
    let model = WidgetModel()

    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        app.run()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let root = WidgetView(model: model)
            .background(Color(red: 0.11, green: 0.10, blue: 0.14).opacity(0.55))
            .background(GlassBackground())
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Color.white.opacity(0.08), lineWidth: 1))
        hosting = NSHostingView(rootView: AnyView(root))
        hosting.frame.size = hosting.fittingSize

        panel = WidgetPanel(contentRect: NSRect(origin: .zero, size: hosting.fittingSize),
                            styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.contentView = hosting
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.appearance = NSAppearance(named: .darkAqua)
        // On the desktop: above the icons, below every app window, on every Space — where macOS widgets live.
        panel.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)) + 1)
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        panel.isMovableByWindowBackground = true
        panel.hidesOnDeactivate = false
        if !panel.setFrameUsingName("AgentLoopWidget"), let screen = NSScreen.screens.first {
            let v = screen.visibleFrame
            panel.setFrameTopLeftPoint(NSPoint(x: v.maxX - panel.frame.width - 24, y: v.maxY - 24))
        }
        panel.setFrameAutosaveName("AgentLoopWidget")
        panel.orderFrontRegardless()

        let menu = NSMenu()
        menu.addItem(withTitle: "Refresh", action: #selector(refresh), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Open AgentLoop", action: #selector(openUI), keyEquivalent: "").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit widget", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
        hosting.menu = menu

        model.onChange = { [weak self] in DispatchQueue.main.async { self?.fit() } }
        model.start()
    }

    /** Grow or shrink with the content, keeping the top-left corner where the user put it. */
    func fit() {
        let size = hosting.fittingSize
        guard size != panel.frame.size else { return }
        let top = panel.frame.maxY
        panel.setFrame(NSRect(x: panel.frame.minX, y: top - size.height, width: size.width, height: size.height),
                       display: true)
    }

    @objc func refresh() { Task { await model.refresh() } }
    @objc func openUI() { NSWorkspace.shared.open(model.cfg.ui) }
}
