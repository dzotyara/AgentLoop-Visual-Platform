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
    const notify = (title: string, body: string, prKey: string, tag = `agentloop:${prKey}`) => {
      const n = new Notification(title, { body, tag, icon: "/pixel/icons/ready.png" });
      n.onclick = () => {
        window.focus();
        openRef.current(prKey);
      };
    };
    const poll = async () => {
      try {
        const status = await getPrPatrolStatus();
        const next = new Map(status.prs.map((p) => [p.pr_key, p.phase]));
        const prev = seen.current;
        seen.current = next;
        if (!prev || notificationsState() !== "granted") return;
        // "Needs you" is one notification per poll for all PRs that entered it, not a ping per PR.
        const needYou: typeof status.prs = [];
        for (const pr of status.prs) {
          const before = prev.get(pr.pr_key);
          if (before === pr.phase) continue;
          if (pr.phase === "blocked") {
            needYou.push(pr);
            continue;
          }
          const merged = before === "merging" && pr.phase === "skipped" && /merged/i.test(pr.summary);
          const title = merged ? "Merged" : NOTIFY[pr.phase];
          if (!title) continue;
          notify(`${title}: ${pr.repo.split("/")[1]} #${pr.number}`, pr.title, pr.pr_key);
        }
        if (needYou.length === 1) {
          const pr = needYou[0];
          notify(`Needs you: ${pr.repo.split("/")[1]} #${pr.number}`, pr.title, pr.pr_key);
        } else if (needYou.length > 1) {
          notify(
            `Needs you: ${needYou.length} PRs`,
            needYou.map((pr) => `${pr.repo.split("/")[1]} #${pr.number}`).join(", "),
            needYou[0].pr_key,
            "agentloop:needs-you",
          );
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
