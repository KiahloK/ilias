import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir: string;
let base: string;
let token: string;
let close: () => void;
let infoPath: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ilias-sync-server-"));
  process.env.ILIAS_SYNC_CONFIG_DIR = dir; // must be set before config.ts is loaded
  const { Daemon } = await import("../src/daemon.js");
  const { startControlServer } = await import("../src/server.js");
  // No config on disk: the daemon must still serve the API so the app can do setup.
  const daemon = new Daemon();
  infoPath = join(dir, "daemon.json");
  const started = await startControlServer(daemon, { infoPath });
  base = `http://127.0.0.1:${started.port}`;
  token = started.token;
  close = () => started.server.close();
});
afterAll(async () => {
  close();
  await rm(dir, { recursive: true, force: true });
});

const api = (path: string, init: RequestInit = {}, auth = true) =>
  fetch(base + path, { ...init, headers: auth ? { Authorization: `Bearer ${token}` } : {} });

describe("control API", () => {
  it("publishes port and token in a private file", async () => {
    const info = JSON.parse(await readFile(infoPath, "utf8"));
    expect(info).toMatchObject({ token, port: Number(base.split(":").pop()) });
    expect((await stat(infoPath)).mode & 0o777).toBe(0o600);
  });

  it("rejects requests without the token", async () => {
    expect((await api("/api/status", {}, false)).status).toBe(401);
  });

  it("reports status and supports pause/resume", async () => {
    expect(await (await api("/api/status")).json()).toMatchObject({ state: "idle", recent: [] });
    expect(await (await api("/api/pause", { method: "POST" })).json()).toMatchObject({ state: "paused" });
    expect(await (await api("/api/resume", { method: "POST" })).json()).not.toMatchObject({ state: "paused" });
  });

  it("returns an unconfigured config", async () => {
    expect(await (await api("/api/config")).json()).toMatchObject({ configured: false, hasPassword: false });
  });

  it("validates input", async () => {
    const res = await api("/api/test-login", { method: "POST", body: JSON.stringify({ baseUrl: "nope" }) });
    expect(res.status).toBe(400);
  });
});
