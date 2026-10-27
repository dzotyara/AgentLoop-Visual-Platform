import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createCrew, FIXER_HELPERS, mergeDuplicateSeats, PATROL_AGENTS, REVIEWER_HELPERS } from "./crew.ts";

function db(): DatabaseSync {
  const d = new DatabaseSync(":memory:");
  d.exec(`CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, name_ko TEXT NOT NULL DEFAULT '',
    department_id TEXT, role TEXT, cli_provider TEXT, avatar_emoji TEXT NOT NULL DEFAULT '', sprite_number INTEGER,
    personality TEXT, stats_tasks_done INTEGER DEFAULT 0, stats_xp INTEGER DEFAULT 0, created_at INTEGER DEFAULT (unixepoch()*1000))`);
  return d;
}
const count = (d: DatabaseSync) => (d.prepare("SELECT COUNT(*) AS n FROM agents").get() as { n: number }).n;
const rename = (d: DatabaseSync, id: string, name: string) =>
  d.prepare("UPDATE agents SET name = ? WHERE id = ?").run(name, id);

describe("crew seats", () => {
  it("creates a seat's agent once and follows it by id after a rename", () => {
    const d = db();
    const crew = createCrew(d);
    const id = crew.agentId(PATROL_AGENTS.reviewer);
    rename(d, id, "Futun");
    expect(createCrew(d).agentId(PATROL_AGENTS.reviewer)).toBe(id); // a restart: no new "Argus"
    expect(crew.name(id, "Argus")).toBe("Futun");
    expect(crew.seats()).toEqual({ [id]: "Argus" });
    expect(count(d)).toBe(1);
  });

  it("re-binds agents renamed before seats existed by the seat key kept in name_ko", () => {
    const d = db();
    d.prepare(
      "INSERT INTO agents (id, name, name_ko) VALUES ('a1', 'Futun', 'Argus'), ('r1', 'Timurchik', 'Rivet')",
    ).run();
    const crew = createCrew(d);
    expect(crew.agentId(PATROL_AGENTS.reviewer)).toBe("a1");
    expect(crew.agentId(FIXER_HELPERS[0])).toBe("r1");
    expect(count(d)).toBe(2);
  });

  it("falls back to the seat key when the agent row is gone, and re-creates it", () => {
    const d = db();
    const crew = createCrew(d);
    const id = crew.agentId(PATROL_AGENTS.gate);
    d.prepare("DELETE FROM agents WHERE id = ?").run(id);
    expect(crew.name(id, "Gate")).toBe("Gate");
    const again = crew.agentId(PATROL_AGENTS.gate);
    expect(again).not.toBe(id);
    expect(crew.seats()).toEqual({ [again]: "Gate" });
  });

  it("merges the copy a restart made of a renamed agent back into the original", () => {
    const d = db();
    d.exec(`CREATE TABLE tasks (id TEXT PRIMARY KEY, assigned_agent_id TEXT REFERENCES agents(id));
      CREATE TABLE project_agents (project_id TEXT, agent_id TEXT REFERENCES agents(id), PRIMARY KEY (project_id, agent_id))`);
    d.prepare(
      `INSERT INTO agents (id, name, name_ko, stats_tasks_done, created_at) VALUES
         ('old', 'Futun', 'Argus', 65, 1), ('copy', 'Argus', 'Argus', 1, 2), ('x', 'Haru', 'Haru', 0, 3)`,
    ).run();
    d.prepare("INSERT INTO tasks VALUES ('t1', 'copy'), ('t2', 'old')").run();
    d.prepare("INSERT INTO project_agents VALUES ('p', 'old'), ('p', 'copy'), ('q', 'copy')").run();
    d.exec("CREATE TABLE pr_patrol_crew (seat TEXT PRIMARY KEY, agent_id TEXT NOT NULL)");
    d.prepare("INSERT INTO pr_patrol_crew VALUES ('Argus', 'copy')").run();

    expect(mergeDuplicateSeats(d)).toBe(1);
    expect(d.prepare("SELECT id, name, stats_tasks_done AS done FROM agents ORDER BY id").all()).toEqual([
      { id: "old", name: "Futun", done: 66 },
      { id: "x", name: "Haru", done: 0 },
    ]);
    expect(d.prepare("SELECT assigned_agent_id AS a FROM tasks ORDER BY id").all()).toEqual([
      { a: "old" },
      { a: "old" },
    ]);
    expect(d.prepare("SELECT project_id AS p, agent_id AS a FROM project_agents ORDER BY p").all()).toEqual([
      { p: "p", a: "old" },
      { p: "q", a: "old" },
    ]);
    expect(createCrew(d).agentId(PATROL_AGENTS.reviewer)).toBe("old");
    expect(mergeDuplicateSeats(d)).toBe(0);
  });

  it("creates helper reviewers under their own names, bound to their seats", () => {
    const d = db();
    const crew = createCrew(d);
    const [hawk, owl] = REVIEWER_HELPERS.map((seat) => crew.agentId(seat));
    expect(d.prepare("SELECT name, name_ko FROM agents ORDER BY name").all()).toEqual([
      { name: "Dmitrly", name_ko: "Owl" },
      { name: "Timur", name_ko: "Hawk" },
    ]);
    expect(crew.seats()).toEqual({ [hawk]: "Hawk", [owl]: "Owl" });
    expect(createCrew(d).agentId(REVIEWER_HELPERS[0])).toBe(hawk);
  });
});
