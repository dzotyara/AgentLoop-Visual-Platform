import { useMemo } from "react";
import type { CSSProperties } from "react";
import type { Agent } from "../types";
import { packSkinSpriteFor } from "./pack-sprite-skin";
import PixelIcon from "./pixel/PixelIcon";
import { iconFor } from "./pixel/emoji-to-icon";

/** Map agent IDs to sprite numbers (stable order, same as OfficeView) */
export function buildSpriteMap(agents: Agent[]): Map<string, number> {
  const map = new Map<string, number>();
  // 0) the active office pack's character skin, if it has one
  for (const a of agents) {
    const skin = packSkinSpriteFor(a);
    if (skin) map.set(a.id, skin);
  }
  // 1) sprite_number가 DB에 지정된 에이전트 우선
  for (const a of agents) {
    if (!map.has(a.id) && a.sprite_number != null && a.sprite_number > 0) map.set(a.id, a.sprite_number);
  }
  // 2) DORO fallback (sprite_number 미지정시)
  const doro = agents.find((a) => a.name === "DORO");
  if (doro && !map.has(doro.id)) map.set(doro.id, 13);
  // 3) 나머지: 자동 할당 (1-12 순환)
  const rest = [...agents].filter((a) => !map.has(a.id)).sort((a, b) => a.id.localeCompare(b.id));
  rest.forEach((a, i) => map.set(a.id, (i % 12) + 1));
  return map;
}

/** Hook: memoized sprite map from agents array */
export function useSpriteMap(agents: Agent[]): Map<string, number> {
  return useMemo(() => buildSpriteMap(agents), [agents]);
}

/** Get the sprite number for an agent by ID */
export function getSpriteNum(agents: Agent[], agentId: string): number | undefined {
  return buildSpriteMap(agents).get(agentId);
}

function hashIdToSprite(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return (hash % 12) + 1;
}

function resolveSpriteNum(agent: Agent | undefined, spriteMap: Map<string, number>): number | undefined {
  if (!agent) return undefined;
  const skin = packSkinSpriteFor(agent);
  if (skin) return skin;
  if (agent.sprite_number != null && agent.sprite_number > 0) return agent.sprite_number;
  const mapped = spriteMap.get(agent.id);
  if (mapped != null && mapped > 0) return mapped;
  if (agent.name === "DORO") return 13;
  return hashIdToSprite(agent.id);
}

interface AgentAvatarProps {
  agent: Agent | undefined;
  agents?: Agent[];
  spriteMap?: Map<string, number>;
  size?: number;
  className?: string;
  rounded?: "full" | "xl" | "2xl";
  imageFit?: "cover" | "contain";
  imagePosition?: CSSProperties["objectPosition"];
}

/** Sprite-based avatar — pass either `agents` or `spriteMap` */
export default function AgentAvatar({
  agent,
  agents,
  spriteMap,
  size = 28,
  className = "",
  rounded = "full",
  imageFit = "cover",
  imagePosition = "center",
}: AgentAvatarProps) {
  const map = spriteMap ?? (agents ? buildSpriteMap(agents) : new Map());
  const spriteNum = resolveSpriteNum(agent, map);

  const roundedClass = rounded === "full" ? "rounded-full" : rounded === "xl" ? "rounded-xl" : "rounded-2xl";

  if (spriteNum) {
    return (
      <div
        className={`${roundedClass} overflow-hidden bg-gray-700 flex-shrink-0 ${className}`}
        style={{ width: size, height: size }}
      >
        <img
          src={`/sprites/${spriteNum}-D-1.png`}
          alt={agent?.name ?? ""}
          className={`w-full h-full ${imageFit === "contain" ? "object-contain" : "object-cover"}`}
          style={{ imageRendering: "pixelated", objectPosition: imagePosition }}
        />
      </div>
    );
  }
  return (
    <div
      className={`${roundedClass} bg-gray-700 flex items-center justify-center flex-shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <PixelIcon
        name={iconFor(agent?.avatar_emoji, "robot")}
        size={Math.max(16, Math.round((size * 0.6) / 16) * 16)}
      />
    </div>
  );
}
