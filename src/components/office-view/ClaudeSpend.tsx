import { formatUsd, getClaudeCosts } from "../../api";
import { usePolling } from "../../hooks/usePolling";

/** Claude spend from the agents' own run results (Claude Code's list-price figures), for the CLI Usage card. */
export default function ClaudeSpend() {
  const { data } = usePolling(getClaudeCosts, 30_000);
  if (!data) return null;
  const topModels = data.byModel.slice(0, 3);
  const topAgents = data.byAgent.filter((a) => a.costUsd > 0).slice(0, 4);
  return (
    <div className="mb-2 space-y-1.5">
      <div className="grid grid-cols-3 gap-1.5">
        {(
          [
            ["Today", data.today],
            ["7 days", data.last7d],
            ["30 days", data.last30d],
          ] as const
        ).map(([label, w]) => (
          <div key={label} className="rounded-lg bg-black/10 px-2 py-1 text-center">
            <div className="text-[10px] text-slate-500">{label}</div>
            <div className="text-sm font-semibold text-violet-500">{formatUsd(w.costUsd)}</div>
            <div className="text-[9px] text-slate-500">{w.runs} runs</div>
          </div>
        ))}
      </div>
      {topModels.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-500">
          {topModels.map((m) => (
            <span key={m.key}>
              {m.label.replace(/^claude-/, "")} <b className="text-slate-400">{formatUsd(m.costUsd)}</b>
            </span>
          ))}
        </div>
      )}
      {topAgents.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-500">
          {topAgents.map((a) => (
            <span key={a.key}>
              {a.label} <b className="text-slate-400">{formatUsd(a.costUsd)}</b>
            </span>
          ))}
        </div>
      )}
      <div className="text-[9px] italic text-slate-500">7-day breakdown · API list prices reported by Claude Code</div>
    </div>
  );
}
