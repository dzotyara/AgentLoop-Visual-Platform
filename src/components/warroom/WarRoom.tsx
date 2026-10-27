import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Agent } from "../../types";
import { formatUsd, getClaudeCosts, getPrPatrolStatus, type PrPatrolPhase, type PrPatrolPr } from "../../api";
import { usePolling } from "../../hooks/usePolling";
import { buildSpriteMap } from "../AgentAvatar";
import PixelIcon, { type PixelIconName } from "../pixel/PixelIcon";
import { setLiveFromStatus } from "../pr-patrol/live-store";
import { ACTION_LABEL, checksSummary } from "../pr-patrol/pr-ui";
import WarRoomAgent from "./WarRoomAgent";
import {
  SCENE_H,
  SCENE_W,
  STATIONS,
  STATION_BY_AGENT,
  STRIPE_H,
  TABLE,
  WALL_H,
  pinSlots,
  workSpot,
  type StationKey,
} from "./layout";
import "./warroom.css";

const TEX = "/pixel/warroom";

const PIN_COLOR: Record<PrPatrolPhase, string> = {
  working: "#4aa3d8",
  blocked: "#c8423a",
  waiting: "#e0a030",
  watching: "#8a8a86",
  ready: "#3fae5a",
  error: "#8e2a24",
  skipped: "#5a5a5a",
};

const PHASE_LABEL: Record<PrPatrolPhase, string> = {
  working: "Agent working",
  blocked: "Needs you",
  waiting: "Waiting",
  watching: "Queued",
  ready: "Ready to merge",
  error: "Error",
  skipped: "Skipped",
};

/** Absolutely positioned box in logical units, with an optional texture and a flat fallback colour. */
function box(scale: number, x: number, y: number, w: number, h: number, extra: CSSProperties = {}): CSSProperties {
  return { position: "absolute", left: x * scale, top: y * scale, width: w * scale, height: h * scale, ...extra };
}
function tex(file: string, fallback: string, tile?: { w: number; h: number; scale: number }): CSSProperties {
  return {
    backgroundColor: fallback,
    backgroundImage: `url(${TEX}/${file})`,
    backgroundSize: tile ? `${tile.w * tile.scale}px ${tile.h * tile.scale}px` : "100% 100%",
    backgroundRepeat: tile ? "repeat" : "no-repeat",
    imageRendering: "pixelated",
  };
}

const short = (pr: PrPatrolPr) => `${pr.repo.split("/")[1]} #${pr.number}`;

export default function WarRoom({ agents, onOpenPr }: { agents: Agent[]; onOpenPr: (prKey: string) => void }) {
  const { data } = usePolling(getPrPatrolStatus, 2000);
  const { data: costs } = usePolling(getClaudeCosts, 30_000);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);

  useEffect(() => {
    if (data) setLiveFromStatus(data);
  }, [data]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Half-step scales keep pixels close to square while filling the width.
  const scale = Math.max(1.5, Math.floor((width / SCENE_W) * 2) / 2);

  const prs = useMemo(() => (data?.prs ?? []).filter((p) => p.phase !== "skipped"), [data]);
  const slots = useMemo(() => pinSlots(prs.map((p) => p.pr_key)), [prs]);
  const spriteMap = useMemo(() => buildSpriteMap(agents), [agents]);
  const crew = agents.filter((a) => STATION_BY_AGENT[a.name]);
  const readyPrs = prs.filter((p) => p.phase === "ready");
  const counts = prs.reduce<Partial<Record<PrPatrolPhase, number>>>((acc, p) => {
    acc[p.phase] = (acc[p.phase] ?? 0) + 1;
    return acc;
  }, {});

  const placeAgent = (agent: Agent, stationKey: StationKey, index: number) => {
    const station = STATIONS[stationKey];
    const job = prs.find((p) => p.agent?.id === agent.id);
    const jobPin = job ? slots.get(job.pr_key) : undefined;
    if (job && jobPin) {
      return {
        spot: workSpot(jobPin, index),
        working: true,
        job,
        bubble: {
          title: `${short(job)} · ${ACTION_LABEL[job.agent!.action] ?? job.agent!.action}`,
          line: job.agent!.activity,
          tone: "work" as const,
        },
      };
    }
    if (stationKey === "gate" && readyPrs[0] && slots.get(readyPrs[0].pr_key)) {
      const pin = slots.get(readyPrs[0].pr_key)!;
      return {
        spot: workSpot(pin, 1),
        working: false,
        job: readyPrs[0],
        bubble: {
          title: readyPrs.length > 1 ? `Ready to merge (${readyPrs.length})` : "Ready to merge",
          line: short(readyPrs[0]),
          tone: "ready" as const,
        },
      };
    }
    return { spot: station.home, working: false, job: undefined, bubble: null };
  };

  const placed = crew.map((agent, i) => ({
    agent,
    key: STATION_BY_AGENT[agent.name],
    ...placeAgent(agent, STATION_BY_AGENT[agent.name], i),
  }));
  const s = scale;

  return (
    <div ref={wrapRef} className="w-full">
      <div
        className="relative mx-auto overflow-hidden rounded-lg"
        style={{ width: SCENE_W * s, height: SCENE_H * s, background: "#2a2a2e" }}
      >
        {/* bunker shell */}
        <div
          className="warroom-tex"
          style={box(s, 0, 0, SCENE_W, WALL_H, tex("wall.png", "#55534c", { w: 32, h: 48, scale: s }))}
        />
        <div
          className="warroom-tex"
          style={box(s, 0, WALL_H, SCENE_W, STRIPE_H, tex("stripe.png", "#c9a227", { w: 32, h: 8, scale: s / 2 }))}
        />
        <div
          className="warroom-tex"
          style={box(
            s,
            0,
            WALL_H + STRIPE_H,
            SCENE_W,
            SCENE_H - WALL_H - STRIPE_H,
            tex("floor.png", "#6f6d66", { w: 32, h: 32, scale: s }),
          )}
        />

        {/* hanging lamps with flickering light pools */}
        {[160, 240].map((x) => (
          <div key={x}>
            <div style={box(s, x - 8, 0, 16, 24, tex("lamp.png", "transparent"))} />
            <div
              className="warroom-lamp-glow pointer-events-none"
              style={box(s, x - 60, 44, 120, 90, {
                background: "radial-gradient(ellipse at 50% 0%, rgba(255,214,140,0.28), rgba(255,214,140,0) 70%)",
              })}
            />
          </div>
        ))}

        {/* props */}
        <div style={box(s, 92, 196, 40, 16, tex("sandbags.png", "transparent"))} />
        <div style={box(s, 268, 196, 40, 16, tex("sandbags.png", "transparent"))} />
        <div style={box(s, 374, 112, 24, 20, tex("crate.png", "transparent"))} />
        <div style={box(s, 2, 112, 24, 20, tex("crate.png", "transparent"))} />
        <div style={box(s, 380, 200, 16, 22, tex("barrel.png", "transparent"))} />

        {/* wall monitors: one per station */}
        {Object.values(STATIONS).map((st) => {
          const p = placed.find((x) => x.key === st.key);
          const state = p?.working ? "WORKING" : p?.bubble ? "READY" : p ? "STANDBY" : "OFFLINE";
          const color = p?.working ? "#8fd0ff" : p?.bubble ? "#8fe39a" : "#9a9a92";
          return (
            <div key={st.key} style={box(s, st.screen.x, st.screen.y, 64, 34, tex("screen.png", "#2b2d31"))}>
              <div
                className="warroom-font absolute overflow-hidden"
                style={{
                  inset: 4 * s,
                  fontSize: 4.2 * s,
                  lineHeight: 1.3,
                  color,
                  background: "rgba(8,14,10,0.55)",
                  padding: `${0.8 * s}px ${1.2 * s}px`,
                }}
              >
                <div className="flex items-center justify-between">
                  <span style={{ color: "#e8e8e0" }}>{st.label}</span>
                  <span>{state}</span>
                </div>
                <div className="truncate">{p?.job ? short(p.job) : st.role}</div>
                <div className="truncate" style={{ opacity: 0.85 }}>
                  {p?.working ? p.job?.agent?.activity : p?.bubble ? "merge when you can" : "—"}
                </div>
              </div>
            </div>
          );
        })}

        {/* map table */}
        <div style={box(s, TABLE.x, TABLE.y, TABLE.w, TABLE.h, tex("table.png", "#6b4f2e"))} />

        {/* stations and nameplates */}
        {Object.values(STATIONS).map((st) => (
          <div key={st.key}>
            <div style={box(s, st.x, st.y, 64, 48, tex(`station-${st.key}.png`, "rgba(70,72,60,0.6)"))} />
            <div
              className="warroom-font flex items-center justify-center gap-1"
              style={box(s, st.x + 8, st.y + 48, 48, 12, {
                ...tex("plate.png", "#4a4c50"),
                fontSize: 4.2 * s,
                color: "#1c1b22",
              })}
            >
              <PixelIcon name={st.icon as PixelIconName} size={6 * s} />
              {st.label}
            </div>
          </div>
        ))}

        {/* PR pins on the map */}
        {prs.map((pr) => {
          const pin = slots.get(pr.pr_key);
          if (!pin) return null;
          const checks = checksSummary(pr.snapshot?.checks ?? []);
          return (
            <div
              key={pr.pr_key}
              className="warroom-pin absolute"
              style={{ left: (pin.x - 6) * s, top: (pin.y - 18) * s, width: 12 * s, height: 18 * s, zIndex: pin.y }}
            >
              <button
                type="button"
                onClick={() => onOpenPr(pr.pr_key)}
                className={`absolute inset-0 ${pr.agent ? "warroom-pin-active" : ""}`}
                style={tex(`pin-${pr.phase === "skipped" ? "watching" : pr.phase}.png`, PIN_COLOR[pr.phase])}
                aria-label={`${short(pr)}: ${PHASE_LABEL[pr.phase]}`}
              />
              <div
                className="warroom-font pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap"
                style={{
                  top: 18 * s,
                  fontSize: 4 * s,
                  lineHeight: 1,
                  padding: `${0.5 * s}px ${1 * s}px`,
                  color: "#f2efe4",
                  background: "rgba(20,20,26,0.8)",
                  borderBottom: `${Math.max(1, s / 2)}px solid ${PIN_COLOR[pr.phase]}`,
                }}
              >
                {short(pr)}
              </div>
              {/* hover card */}
              <div
                className="warroom-pin-card warroom-font absolute"
                style={{
                  left: 14 * s,
                  top: -2 * s,
                  width: 120 * s,
                  zIndex: 500,
                  fontSize: 4.2 * s,
                  lineHeight: 1.3,
                  color: "#1c1b22",
                  background: "#f2efe4",
                  border: `${Math.max(1, s / 2)}px solid ${PIN_COLOR[pr.phase]}`,
                  boxShadow: `0 ${s}px 0 rgba(0,0,0,0.35)`,
                  padding: `${1.5 * s}px ${2 * s}px`,
                }}
              >
                <div style={{ color: PIN_COLOR[pr.phase], fontWeight: 700 }}>
                  {PHASE_LABEL[pr.phase]} · {short(pr)}
                </div>
                <div className="line-clamp-2" style={{ fontWeight: 700 }}>
                  {pr.title}
                </div>
                <div className="line-clamp-2" style={{ color: "#4a4a52" }}>
                  {pr.agent ? `${pr.agent.name}: ${pr.agent.activity}` : pr.summary}
                </div>
                <div style={{ color: "#4a4a52" }}>Checks: {checks.text}</div>
              </div>
            </div>
          );
        })}

        {/* crew */}
        {placed.map(({ agent, spot, working, bubble }) => (
          <WarRoomAgent
            key={agent.id}
            name={agent.name}
            spriteNum={spriteMap.get(agent.id) ?? 1}
            x={spot.x}
            y={spot.y}
            scale={s}
            working={working}
            bubble={bubble}
          />
        ))}

        {/* HUD */}
        <div
          className="warroom-font absolute flex items-center gap-3"
          style={{
            left: 100 * s,
            top: 47 * s,
            fontSize: 4.4 * s,
            color: "#f2efe4",
            background: "rgba(20,20,26,0.72)",
            padding: `${1 * s}px ${2.5 * s}px`,
            zIndex: 300,
          }}
        >
          {(
            [
              ["working", "robot"],
              ["blocked", "you"],
              ["waiting", "pending"],
              ["ready", "ready"],
            ] as const
          ).map(([phase, icon]) => (
            <span key={phase} className="flex items-center gap-1" style={{ color: PIN_COLOR[phase] }}>
              <PixelIcon name={icon} size={6 * s} />
              {counts[phase] ?? 0} {PHASE_LABEL[phase]}
            </span>
          ))}
          {costs && (
            <span className="flex items-center gap-1" style={{ color: "#c9b6ff" }}>
              <PixelIcon name="spend" size={6 * s} />
              {formatUsd(costs.today.costUsd)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
