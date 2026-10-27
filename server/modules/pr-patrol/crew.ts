import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type AgentRole = "reviewer" | "fixer" | "ci" | "conflict" | "gate";

/**
 * One crew seat. `key` is its stable identity (also the name a fresh agent row gets); the person in the seat
 * keeps the agent row, so renaming it in the office never loses the seat, its desk or its sprite.
 */
export type CrewSeat = { key: string; dept: string; role: string; emoji: string; sprite: number; personality: string };

/** The patrol's own staff: they sit in the pixel office and pick up the loop's tasks. */
export const PATROL_AGENTS: Record<AgentRole, CrewSeat> = {
  reviewer: {
    key: "Argus",
    dept: "qa",
    role: "senior",
    emoji: "scope",
    sprite: 7,
    personality: "PR reviewer: correctness, silent failures, security",
  },
  fixer: {
    key: "Patch",
    dept: "dev",
    role: "senior",
    emoji: "wrench",
    sprite: 3,
    personality: "Applies review findings and reviewer comments",
  },
  ci: {
    key: "Medic",
    dept: "devsecops",
    role: "senior",
    emoji: "medkit",
    sprite: 9,
    personality: "Reads failing CI logs and fixes the branch",
  },
  conflict: {
    key: "Weaver",
    dept: "dev",
    role: "junior",
    emoji: "bomb",
    sprite: 11,
    personality: "Merges the base branch and resolves conflicts",
  },
  gate: {
    key: "Gate",
    dept: "operations",
    role: "senior",
    emoji: "shield",
    sprite: 5,
    personality: "Declares a PR ready once checks, threads and review are clean",
  },
};

/** Extra fixers beyond Patch, enabled by PR_PATROL_FIXERS (each works a different PR). */
export const FIXER_HELPERS: CrewSeat[] = [
  {
    key: "Rivet",
    dept: "dev",
    role: "junior",
    emoji: "wrench",
    sprite: 4,
    personality: "Second fixer: review findings and comments on another PR",
  },
  {
    key: "Splice",
    dept: "dev",
    role: "junior",
    emoji: "wrench",
    sprite: 6,
    personality: "Third fixer: review findings and comments on another PR",
  },
];

export function ensureCrewSchema(db: DatabaseSync): void {
  db.exec("CREATE TABLE IF NOT EXISTS pr_patrol_crew (seat TEXT PRIMARY KEY, agent_id TEXT NOT NULL)");
}

/**
 * Seat -> agent row. A seat is bound once and then followed by id. Before seats existed agents were found by
 * name; a row created then still carries the seat key in name_ko (set at creation), so a renamed agent is
 * re-bound to its seat instead of getting a duplicate.
 */
export function createCrew(db: DatabaseSync, onCreated: (row: unknown) => void = () => {}) {
  ensureCrewSchema(db);
  mergeDuplicateSeats(db);

  function agentId(seat: CrewSeat): string {
    const bound = db
      .prepare("SELECT c.agent_id AS id FROM pr_patrol_crew c JOIN agents a ON a.id = c.agent_id WHERE c.seat = ?")
      .get(seat.key) as { id: string } | undefined;
    let id = bound?.id;
    if (!id) {
      const legacy = db
        .prepare(
          `SELECT id FROM agents WHERE (name = ? OR name_ko = ?) AND id NOT IN (SELECT agent_id FROM pr_patrol_crew)
           ORDER BY (name = ?) DESC, created_at LIMIT 1`,
        )
        .get(seat.key, seat.key, seat.key) as { id: string } | undefined;
      id = legacy?.id;
      if (!id) {
        id = randomUUID();
        db.prepare(
          `INSERT INTO agents (id, name, name_ko, department_id, role, cli_provider, avatar_emoji, sprite_number, personality)
           VALUES (?, ?, ?, ?, ?, 'claude', ?, ?, ?)`,
        ).run(id, seat.key, seat.key, seat.dept, seat.role, seat.emoji, seat.sprite, seat.personality);
        onCreated(db.prepare("SELECT * FROM agents WHERE id = ?").get(id));
      }
      db.prepare("INSERT OR REPLACE INTO pr_patrol_crew (seat, agent_id) VALUES (?, ?)").run(seat.key, id);
    }
    // avatars are pixel-icon names now (the UI shows no emoji); migrate rows created with emoji
    db.prepare("UPDATE agents SET avatar_emoji = ? WHERE id = ? AND avatar_emoji != ?").run(seat.emoji, id, seat.emoji);
    return id;
  }

  /** The agent's current name (as renamed in the office), or the seat key when the row is gone. */
  function name(id: string, fallback: string): string {
    const row = db.prepare("SELECT name FROM agents WHERE id = ?").get(id) as { name: string } | undefined;
    return row?.name?.trim() || fallback;
  }

  /** Agent id -> seat key for every bound seat, for the UI (desks, sprites, idle spots). */
  function seats(): Record<string, string> {
    const rows = db.prepare("SELECT seat, agent_id FROM pr_patrol_crew").all() as Array<{
      seat: string;
      agent_id: string;
    }>;
    return Object.fromEntries(rows.map((r) => [r.agent_id, r.seat]));
  }

  return { agentId, name, seats };
}

/**
 * Before seats, a restart looked crew up by name: an agent renamed in the office was not found and a second
 * row with the seat's name was created. Every crew row carries its seat key in name_ko, so rows sharing one are
 * the same crew member: the oldest (the one the user renamed) keeps the seat, tasks and stats; the copies go.
 * Returns how many copies were merged. Idempotent.
 */
export function mergeDuplicateSeats(db: DatabaseSync): number {
  const seatKeys = [...Object.values(PATROL_AGENTS), ...FIXER_HELPERS].map((s) => s.key);
  // every column that points at an agent row: declared foreign keys plus *agent_id columns without one
  const refs: Array<{ table: string; column: string }> = [];
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;
  for (const { name: table } of tables) {
    if (table === "agents") continue;
    const fks = db.prepare(`PRAGMA foreign_key_list("${table}")`).all() as Array<{ table: string; from: string }>;
    const cols = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
    const columns = new Set([
      ...fks.filter((f) => f.table === "agents").map((f) => f.from),
      ...cols.map((c) => c.name).filter((c) => c.endsWith("agent_id")),
    ]);
    for (const column of columns) refs.push({ table, column });
  }

  let merged = 0;
  for (const key of seatKeys) {
    const rows = db
      .prepare(
        "SELECT id, stats_tasks_done AS done, stats_xp AS xp FROM agents WHERE name_ko = ? ORDER BY created_at, rowid",
      )
      .all(key) as Array<{ id: string; done: number | null; xp: number | null }>;
    if (rows.length < 2) continue;
    const [keep, ...copies] = rows;
    db.exec("BEGIN");
    try {
      for (const copy of copies) {
        for (const { table, column } of refs) {
          // a composite key may already hold the kept agent (project_agents): drop the copy's row then
          db.prepare(`UPDATE OR IGNORE "${table}" SET "${column}" = ? WHERE "${column}" = ?`).run(keep.id, copy.id);
          db.prepare(`DELETE FROM "${table}" WHERE "${column}" = ?`).run(copy.id);
        }
        db.prepare(
          "UPDATE agents SET stats_tasks_done = COALESCE(stats_tasks_done, 0) + ?, stats_xp = COALESCE(stats_xp, 0) + ? WHERE id = ?",
        ).run(copy.done ?? 0, copy.xp ?? 0, keep.id);
        db.prepare("DELETE FROM agents WHERE id = ?").run(copy.id);
        merged++;
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  return merged;
}
