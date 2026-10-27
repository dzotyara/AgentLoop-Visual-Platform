import type { Agent } from "../../types";
import { getClaudeCosts, getPrPatrolStatus } from "../../api";
import { usePolling } from "../../hooks/usePolling";
import PixelIcon from "../pixel/PixelIcon";
import PrDetail from "../pr-patrol/PrDetail";
import SlideOver from "./SlideOver";

/** A PR's full card (Auto-fix, status, checks, comments, agent runs) in a glass sheet over the war room. */
export default function PrSlideOver({
  prKey,
  agents,
  onClose,
  onOpenFullPage,
  onOpenTerminal,
}: {
  prKey: string | null;
  agents: Agent[];
  onClose: () => void;
  onOpenFullPage: (prKey: string) => void;
  onOpenTerminal: (taskId: string) => void;
}) {
  const { data } = usePolling(getPrPatrolStatus, 3000, [prKey]);
  const { data: costs } = usePolling(getClaudeCosts, 30_000);
  const pr = prKey ? data?.prs.find((p) => p.pr_key === prKey) : undefined;

  return (
    <SlideOver open={Boolean(prKey)} onClose={onClose} label="Pull request">
      <div className="sticky top-0 z-10 flex items-center justify-end gap-2 px-4 pt-4 pb-2">
        {prKey && (
          <button
            type="button"
            onClick={() => onOpenFullPage(prKey)}
            className="header-action-btn header-action-btn-secondary text-xs"
          >
            <PixelIcon name="external" size={16} />
            Open full page
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="header-action-btn header-action-btn-secondary text-xs"
        >
          <PixelIcon name="close" size={16} />
        </button>
      </div>
      <div className="px-5 pb-6">
        {pr ? (
          <PrDetail
            pr={pr}
            agents={agents}
            onOpenTerminal={onOpenTerminal}
            spend={costs?.byPr.find((b) => b.key === pr.pr_key)}
          />
        ) : (
          <p className="py-10 text-center text-sm" style={{ color: "var(--th-text-muted)" }}>
            {prKey ? "Loading…" : ""}
          </p>
        )}
      </div>
    </SlideOver>
  );
}
