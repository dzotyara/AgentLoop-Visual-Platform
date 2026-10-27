import { useSyncExternalStore } from "react";

/** The pr-patrol crew seats (server: crew.ts). A seat is stable; the agent sitting in it can be renamed. */
export const CREW_SEATS = ["Argus", "Hawk", "Owl", "Patch", "Rivet", "Splice", "Medic", "Weaver", "Gate"] as const;
export type CrewSeat = (typeof CREW_SEATS)[number];

let seats: Record<string, string> = {};
const listeners = new Set<() => void>();

/** Agent id -> seat, from every pr-patrol status response. */
export function setCrewSeats(next: Record<string, string> | undefined): void {
  if (!next) return;
  const same =
    Object.keys(next).length === Object.keys(seats).length && Object.entries(next).every(([k, v]) => seats[k] === v);
  if (same) return;
  seats = next;
  for (const l of listeners) l();
}

/**
 * The crew seat of an agent, by id. Until the first status response arrives the seat is guessed from the
 * name, which still holds for agents nobody renamed.
 */
export function crewSeatOf(agent: { id: string; name: string } | undefined): CrewSeat | undefined {
  if (!agent) return undefined;
  const seat = Object.keys(seats).length > 0 ? seats[agent.id] : agent.name;
  return (CREW_SEATS as readonly string[]).includes(seat ?? "") ? (seat as CrewSeat) : undefined;
}

/** Re-renders the caller when the seat map changes (seats bound, agents re-seated). */
export function useCrewSeats(): Record<string, string> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => seats,
  );
}
