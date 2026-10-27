import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getPrPatrolStatus, triggerPrPatrolTick, type PrPatrolStatus } from "../../api";
import PixelIcon, { type PixelIconName } from "../pixel/PixelIcon";
import { notificationsState, requestLoopNotifications } from "./loop-notifications";

export type PaletteView = { view: string; label: string; icon: PixelIconName };

type Command = {
  id: string;
  title: string;
  hint?: string;
  icon: PixelIconName;
  group: "Go to" | "Pull requests" | "Actions";
  run: () => void | Promise<void>;
};

/** Plain subsequence match: every typed character in order. Scores earlier, tighter matches higher. */
function score(text: string, query: string): number {
  if (!query) return 1;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  const direct = t.indexOf(q);
  if (direct >= 0) return 100 - direct;
  let i = 0;
  let gaps = 0;
  for (const ch of t) {
    if (ch === q[i]) i++;
    else if (i > 0) gaps++;
    if (i === q.length) return 50 - gaps;
  }
  return 0;
}

/**
 * Command-K palette: jump to a view or a PR, run the patrol, flip the theme or the office layout,
 * turn on desktop notifications. Opens with Cmd+K / Ctrl+K, arrows move, Enter runs, Esc closes.
 */
export default function CommandPalette({
  views,
  onNavigate,
  onOpenPr,
  onToggleTheme,
}: {
  views: PaletteView[];
  onNavigate: (view: string) => void;
  onOpenPr: (prKey: string) => void;
  onToggleTheme: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<PrPatrolStatus | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
    getPrPatrolStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const close = () => setOpen(false);
    const list: Command[] = views.map((v) => ({
      id: `view:${v.view}`,
      title: v.label,
      icon: v.icon,
      group: "Go to",
      run: () => {
        onNavigate(v.view);
        close();
      },
    }));
    for (const pr of (status?.prs ?? []).filter((p) => p.phase !== "skipped")) {
      list.push({
        id: `pr:${pr.pr_key}`,
        title: `${pr.repo.split("/")[1]} #${pr.number} ${pr.title}`,
        hint: pr.agent ? `${pr.agent.name} working` : pr.summary,
        icon: pr.phase === "ready" ? "ready" : pr.phase === "merging" ? "merge" : pr.agent ? "robot" : "prs",
        group: "Pull requests",
        run: () => {
          onOpenPr(pr.pr_key);
          close();
        },
      });
    }
    list.push(
      {
        id: "act:tick",
        title: "Check all PRs now",
        icon: "refresh",
        group: "Actions",
        run: async () => {
          await triggerPrPatrolTick();
          close();
        },
      },
      {
        id: "act:theme",
        title: "Toggle light / dark",
        icon: "sun",
        group: "Actions",
        run: () => {
          onToggleTheme();
          close();
        },
      },
      {
        id: "act:notify",
        title:
          notificationsState() === "granted"
            ? "Desktop notifications are on"
            : notificationsState() === "denied"
              ? "Desktop notifications are blocked in the browser settings"
              : "Turn on desktop notifications",
        hint: "Ready to merge, merged queue, needs you",
        icon: "bell",
        group: "Actions",
        run: async () => {
          await requestLoopNotifications();
          close();
        },
      },
    );
    return list;
  }, [views, status, onNavigate, onOpenPr, onToggleTheme]);

  const results = useMemo(
    () =>
      commands
        .map((c) => ({ c, s: score(`${c.title} ${c.hint ?? ""}`, query) }))
        .filter((r) => r.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 40)
        .map((r) => r.c),
    [commands, query],
  );

  useEffect(() => setIndex(0), [query]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      void results[index]?.run();
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  let lastGroup = "";
  return createPortal(
    <>
      <div
        className="al-scrim"
        data-open={open}
        style={{ pointerEvents: open ? "auto" : "none", zIndex: 70 }}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <div
        className="al-palette"
        data-open={open}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        aria-hidden={!open}
        style={{ pointerEvents: open ? "auto" : "none" }}
      >
        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: "1px solid var(--th-border)" }}>
          <PixelIcon name="search" size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Go to a view, a PR, or run a command"
            className="w-full bg-transparent text-[15px] outline-none"
            style={{ color: "var(--th-text-primary)" }}
            aria-label="Search commands"
          />
          <kbd
            className="rounded-md px-1.5 py-0.5 text-[11px]"
            style={{ border: "1px solid var(--th-border)", color: "var(--th-text-muted)" }}
          >
            esc
          </kbd>
        </div>
        <ul className="max-h-[55vh] overflow-y-auto py-2" role="listbox">
          {results.length === 0 && (
            <li className="px-4 py-6 text-center text-sm" style={{ color: "var(--th-text-muted)" }}>
              No matches
            </li>
          )}
          {results.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <li key={c.id}>
                {header && (
                  <div className="px-4 pt-2 pb-1 text-[11px] font-medium" style={{ color: "var(--th-text-muted)" }}>
                    {header}
                  </div>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === index}
                  className="al-palette-row mx-2 flex w-[calc(100%-16px)] items-center gap-3 rounded-[10px] px-3 py-2 text-left"
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => void c.run()}
                >
                  <PixelIcon name={c.icon} size={16} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm" style={{ color: "var(--th-text-primary)" }}>
                      {c.title}
                    </span>
                    {c.hint && (
                      <span className="block truncate text-xs" style={{ color: "var(--th-text-muted)" }}>
                        {c.hint}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </>,
    document.body,
  );
}
