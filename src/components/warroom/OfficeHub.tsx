import { useState, type ComponentProps } from "react";
import { useI18n } from "../../i18n";
import OfficeView from "../OfficeView";
import CliUsagePanel from "../office-view/CliUsagePanel";
import { useCliUsage } from "../office-view/useCliUsage";
import PrPatrolOfficeBoard from "../pr-patrol/PrPatrolOfficeBoard";
import PrSlideOver from "../shell/PrSlideOver";
import { requestPrSelection } from "./pr-selection";
import WarRoom from "./WarRoom";

type OfficeViewProps = ComponentProps<typeof OfficeView>;
const STORAGE_KEY = "agentloop.office.layout";

function readLayout(): "warroom" | "classic" {
  try {
    return localStorage.getItem(STORAGE_KEY) === "classic" ? "classic" : "warroom";
  } catch {
    return "warroom";
  }
}

/**
 * The Office tab: the war room (default) or the stock Claw-Empire office, with the PR board and
 * CLI usage under the war room. The choice is remembered per browser.
 */
export default function OfficeHub(
  props: OfficeViewProps & { onOpenPrs: () => void; onOpenTerminal: (taskId: string) => void },
) {
  const [layout, setLayout] = useState(readLayout);
  const [inspected, setInspected] = useState<string | null>(null);
  const { language, t } = useI18n();
  const { cliStatus, cliUsage, refreshing, handleRefreshUsage } = useCliUsage(props.tasks);

  const switchTo = (next: "warroom" | "classic") => {
    setLayout(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // per-browser convenience only
    }
  };

  const toggle = (
    <div className="mb-2 flex justify-end gap-1 text-xs">
      {(["warroom", "classic"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => switchTo(mode)}
          className={`header-action-btn ${layout === mode ? "header-action-btn-primary" : "header-action-btn-secondary"}`}
        >
          {mode === "warroom" ? "War room" : "Classic office"}
        </button>
      ))}
    </div>
  );

  if (layout === "classic") {
    return (
      <div>
        {toggle}
        <OfficeView {...props} />
      </div>
    );
  }

  return (
    <div className="w-full">
      {toggle}
      <WarRoom agents={props.agents} onOpenPr={setInspected} />
      <PrSlideOver
        prKey={inspected}
        agents={props.agents}
        onClose={() => setInspected(null)}
        onOpenTerminal={props.onOpenTerminal}
        onOpenFullPage={(prKey) => {
          setInspected(null);
          requestPrSelection(prKey);
          props.onOpenPrs();
        }}
      />
      <PrPatrolOfficeBoard agents={props.agents} onOpenPrs={props.onOpenPrs} />
      <CliUsagePanel
        cliStatus={cliStatus}
        cliUsage={cliUsage}
        language={language}
        refreshing={refreshing}
        onRefreshUsage={handleRefreshUsage}
        t={t}
      />
    </div>
  );
}
