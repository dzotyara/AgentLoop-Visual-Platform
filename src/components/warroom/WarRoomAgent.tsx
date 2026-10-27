import { useEffect, useRef, useState } from "react";
import { AGENT_H, AGENT_W, fz } from "./layout";

const SPEED = 70; // logical units per second
const STEP_MS = 140;

type Bubble = { title: string; line: string; tone: "work" | "ready" };

/**
 * One crew member: walks (front/side frames) to wherever `x,y` (feet, logical units) points,
 * bobs while working, and carries a speech panel with the PR and its current tool call.
 */
export default function WarRoomAgent({
  name,
  spriteNum,
  x,
  y,
  scale,
  working,
  bubble,
  onClick,
}: {
  name: string;
  spriteNum: number;
  x: number;
  y: number;
  scale: number;
  working: boolean;
  bubble: Bubble | null;
  onClick?: () => void;
}) {
  const pos = useRef({ x, y });
  const target = useRef({ x, y });
  const [frame, setFrame] = useState<{ x: number; y: number; img: string; moving: boolean }>({
    x,
    y,
    img: `${spriteNum}-D-1`,
    moving: false,
  });

  useEffect(() => {
    target.current = { x, y };
  }, [x, y]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let stepAt = last;
    let step = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const dx = target.current.x - pos.current.x;
      const dy = target.current.y - pos.current.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.5) {
        const move = Math.min(dist, SPEED * dt);
        pos.current = { x: pos.current.x + (dx / dist) * move, y: pos.current.y + (dy / dist) * move };
        if (now - stepAt > STEP_MS) {
          stepAt = now;
          step = (step + 1) % 4;
        }
        const img =
          Math.abs(dx) > Math.abs(dy) ? `${spriteNum}-${dx < 0 ? "L" : "R"}-1` : `${spriteNum}-D-${[1, 2, 1, 3][step]}`;
        setFrame({ x: pos.current.x, y: pos.current.y, img, moving: true });
      } else {
        setFrame((f) =>
          f.moving || f.img !== `${spriteNum}-D-1`
            ? { x: target.current.x, y: target.current.y, img: `${spriteNum}-D-1`, moving: false }
            : f,
        );
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spriteNum]);

  const left = (frame.x - AGENT_W / 2) * scale;
  const top = (frame.y - AGENT_H) * scale;
  return (
    <div
      className="absolute"
      style={{ left, top, width: AGENT_W * scale, height: AGENT_H * scale, zIndex: Math.round(frame.y) + 10 }}
    >
      {/* ground shadow */}
      <div
        className="absolute rounded-[50%]"
        style={{
          left: AGENT_W * scale * 0.15,
          bottom: -scale,
          width: AGENT_W * scale * 0.7,
          height: 3 * scale,
          background: "rgba(0,0,0,0.35)",
        }}
      />
      <button
        type="button"
        onClick={onClick}
        title={name}
        className={`absolute inset-0 ${working && !frame.moving ? "warroom-typing" : ""}`}
        style={{
          backgroundImage: `url(/sprites/${frame.img}.png)`,
          backgroundSize: "100% 100%",
          imageRendering: "pixelated",
          cursor: onClick ? "pointer" : "default",
        }}
      />
      {working && !frame.moving && <div className="warroom-sparks" style={{ left: AGENT_W * scale - scale * 2 }} />}
      {/* name tag */}
      <div
        className="warroom-font absolute left-1/2 -translate-x-1/2 whitespace-nowrap px-1"
        style={{
          bottom: -5 * scale,
          fontSize: fz(4.2, scale),
          lineHeight: 1,
          color: "#e8e8e0",
          background: "rgba(20,20,26,0.75)",
          padding: `${0.6 * scale}px ${1.2 * scale}px`,
        }}
      >
        {name}
      </div>
      {bubble && !frame.moving && (
        <div
          className="warroom-font absolute left-1/2 -translate-x-1/2"
          style={{
            bottom: (AGENT_H + 3) * scale,
            width: 96 * scale,
            fontSize: fz(4.2, scale),
            lineHeight: 1.25,
            color: "#1c1b22",
            background: bubble.tone === "ready" ? "#d8f0d0" : "#f2efe4",
            border: `${Math.max(1, scale / 2)}px solid ${bubble.tone === "ready" ? "#3fae5a" : "#4aa3d8"}`,
            boxShadow: `0 ${scale}px 0 rgba(0,0,0,0.35)`,
            padding: `${1.2 * scale}px ${1.8 * scale}px`,
            zIndex: 400,
          }}
        >
          <div className="truncate" style={{ fontWeight: 700 }}>
            {bubble.title}
          </div>
          <div className="truncate" style={{ color: "#4a4a52" }}>
            {bubble.line}
          </div>
        </div>
      )}
    </div>
  );
}
