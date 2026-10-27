import { useEffect, useRef, useState } from "react";
import PixelIcon from "../pixel/PixelIcon";
import { iconFor } from "../pixel/emoji-to-icon";
import { ICON_GROUPS } from "./constants";

export function StackedSpriteIcon({ sprites }: { sprites: [number, number] }) {
  return (
    <span className="relative inline-flex items-center" style={{ width: 22, height: 16 }}>
      <img
        src={`/sprites/${sprites[0]}-D-1.png`}
        alt=""
        className="absolute left-0 top-0 w-4 h-4 rounded-full object-cover"
        style={{ imageRendering: "pixelated", opacity: 0.85 }}
      />
      <img
        src={`/sprites/${sprites[1]}-D-1.png`}
        alt=""
        className="absolute left-1.5 top-px w-4 h-4 rounded-full object-cover"
        style={{ imageRendering: "pixelated", zIndex: 1 }}
      />
    </span>
  );
}

export default function EmojiPicker({
  tr,
  value,
  onChange,
  size = "md",
}: {
  tr: (ko: string, en: string) => string;
  value: string;
  onChange: (emoji: string) => void;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const btnSize = size === "sm" ? "w-10 h-10" : "w-14 h-10";
  const current = value ? iconFor(value, "info") : null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`${btnSize} rounded-lg border flex items-center justify-center transition-all hover:scale-105 hover:shadow-md`}
        style={{ background: "var(--th-input-bg)", borderColor: "var(--th-input-border)" }}
        aria-label={tr("아이콘 선택", "Choose icon")}
        title={current ?? undefined}
      >
        <PixelIcon name={current ?? "info"} size={size === "sm" ? 16 : 24} />
      </button>
      {open && (
        <div
          className="absolute z-[60] top-full mt-1 left-0 rounded-xl shadow-2xl p-3 w-72 max-h-[60vh] overflow-y-auto overscroll-contain"
          style={{
            background: "var(--th-card-bg)",
            border: "1px solid var(--th-card-border)",
            backdropFilter: "blur(20px)",
          }}
        >
          {ICON_GROUPS.map((group) => (
            <div key={group.labelEn} className="mb-2 last:mb-0">
              <div
                className="text-[10px] font-semibold uppercase tracking-widest mb-1"
                style={{ color: "var(--th-text-muted)" }}
              >
                {tr(group.label, group.labelEn)}
              </div>
              <div className="grid grid-cols-8 gap-0.5">
                {group.icons.map((icon) => (
                  <button
                    key={icon}
                    type="button"
                    title={icon}
                    aria-label={icon}
                    onClick={() => {
                      onChange(icon);
                      setOpen(false);
                    }}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:scale-125 hover:bg-[var(--th-bg-surface-hover)] ${
                      current === icon ? "ring-2 ring-blue-400 bg-blue-500/15" : ""
                    }`}
                  >
                    <PixelIcon name={icon} size={16} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
