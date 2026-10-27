import { useEffect, useRef } from "react";
import { getPrPatrolStatus, type PrPatrolPhase } from "../../api";

/** Phases worth a desktop notification when a PR enters them. */
const NOTIFY: Partial<Record<PrPatrolPhase, string>> = {
  ready: "Ready to merge",
  merging: "Entered the merge queue",
  blocked: "Needs you",
};

export function notificationsState(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

export async function requestLoopNotifications(): Promise<NotificationPermission | "unsupported"> {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "default") return Notification.requestPermission();
  return Notification.permission;
}

/**
 * Desktop (macOS) notifications for PR phase changes: ready to merge, entered the merge queue, needs you,
 * and merged (left the queue as merged). Only after the user granted permission; the first poll just
 * records the current phases so a reload never replays old news.
 */
export function useLoopNotifications(onOpenPr: (prKey: string) => void): void {
  const seen = useRef<Map<string, PrPatrolPhase> | null>(null);
  const openRef = useRef(onOpenPr);
  openRef.current = onOpenPr;

  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const status = await getPrPatrolStatus();
        const next = new Map(status.prs.map((p) => [p.pr_key, p.phase]));
        const prev = seen.current;
        seen.current = next;
        if (!prev || notificationsState() !== "granted") return;
        for (const pr of status.prs) {
          const before = prev.get(pr.pr_key);
          if (before === pr.phase) continue;
          const merged = before === "merging" && pr.phase === "skipped" && /merged/i.test(pr.summary);
          const title = merged ? "Merged" : NOTIFY[pr.phase];
          if (!title) continue;
          const n = new Notification(`${title}: ${pr.repo.split("/")[1]} #${pr.number}`, {
            body: pr.title,
            tag: `agentloop:${pr.pr_key}`,
            icon: "/pixel/icons/ready.png",
          });
          n.onclick = () => {
            window.focus();
            openRef.current(pr.pr_key);
          };
        }
      } catch {
        // the next poll retries
      }
    };
    void poll();
    const timer = setInterval(() => {
      if (!stopped) void poll();
    }, 15_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);
}
