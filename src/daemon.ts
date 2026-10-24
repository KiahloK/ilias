import { type Config, loadConfig } from "./config.js";
import { IliasClient } from "./ilias/client.js";
import { getPassword } from "./keychain.js";
import { type SyncResult, syncCourse } from "./sync/sync.js";

export const log = (msg: string) => console.log(`[${new Date().toLocaleString("de-DE")}] ${msg}`);

export async function syncAll(config: Config, password: string, opts: { dryRun?: boolean; filter?: string; videos?: boolean } = {}) {
  const client = new IliasClient(config.baseUrl, config.username, password);
  await client.login();
  const courses = config.courses.filter((c) => !opts.filter || c.title.toLowerCase().includes(opts.filter.toLowerCase()));
  const results: SyncResult[] = [];
  for (const course of courses) {
    log(`${course.title} → ${course.targetDir}`);
    const r = await syncCourse(client, course, { dryRun: opts.dryRun, videos: opts.videos === false ? false : undefined, concurrency: config.concurrency, log: console.log });
    const skipped = Object.entries(r.skippedTypes).map(([t, n]) => `${n}×${t}`).join(", ");
    log(`  ${r.added.length} new, ${r.updated.length} updated, ${r.unchanged} unchanged` +
      (skipped ? `, not synced: ${skipped}` : "") + (r.errors.length ? `, ${r.errors.length} errors` : ""));
    results.push(r);
  }
  return results;
}

export type DaemonState = "idle" | "syncing" | "paused" | "error" | "needs-setup";

export interface DaemonStatus {
  state: DaemonState;
  message?: string;
  lastRun?: { startedAt: string; finishedAt: string; ok: boolean; added: number; updated: number; errors: number };
  nextRun?: string;
  recent: { label: string; path: string; updated: boolean; at: string }[];
  courses: { title: string; targetDir: string }[];
}

const RECENT_LIMIT = 20;

/**
 * Background sync loop. Syncs at start, whenever the interval has elapsed, and on
 * demand. Wall-clock time is checked every minute instead of sleeping for the whole
 * interval, so a sync runs shortly after the computer wakes up.
 * The config and password are re-read on every run so settings changes apply at once.
 */
export class Daemon {
  private paused = false;
  private running = false;
  private failures = 0;
  private nextRun = 0;
  private wake?: () => void;
  private status: DaemonStatus = { state: "idle", recent: [], courses: [] };

  constructor(
    private readonly getConfig: () => Promise<Config> = () => loadConfig(),
    private readonly getSecret: (c: Config) => Promise<string | undefined> = (c) => getPassword(c.baseUrl, c.username),
    private readonly intervalOverride?: number,
  ) {}

  getStatus(): DaemonStatus {
    return {
      ...this.status,
      state: this.running ? "syncing" : this.paused ? "paused" : this.status.state,
      nextRun: this.paused || !this.nextRun ? undefined : new Date(this.nextRun).toISOString(),
    };
  }

  /** Runs a sync as soon as possible (no-op if one is already running). */
  syncNow(): void {
    this.paused = false;
    this.nextRun = 0;
    this.wake?.();
  }

  pause(): void {
    this.paused = true;
    log("Paused.");
  }

  resume(): void {
    this.paused = false;
    log("Resumed.");
    this.wake?.();
  }

  async run(): Promise<never> {
    for (;;) {
      if (!this.paused && Date.now() >= this.nextRun) await this.syncOnce();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 60_000);
        this.wake = () => { clearTimeout(timer); resolve(); };
      });
    }
  }

  private async syncOnce(): Promise<void> {
    let intervalMs = (this.intervalOverride ?? 30) * 60_000;
    const startedAt = new Date().toISOString();
    this.running = true;
    try {
      let config: Config;
      try {
        config = await this.getConfig();
      } catch (err) {
        this.status = { ...this.status, state: "needs-setup", message: (err as Error).message };
        this.nextRun = Date.now() + intervalMs;
        return;
      }
      intervalMs = (this.intervalOverride ?? config.intervalMinutes) * 60_000;
      this.status.courses = config.courses.map((c) => ({ title: c.title, targetDir: c.targetDir }));
      const password = await this.getSecret(config);
      if (!password) {
        this.status = { ...this.status, state: "needs-setup", message: "No password stored. Open Settings to log in." };
        this.nextRun = Date.now() + intervalMs;
        return;
      }

      const results = await syncAll(config, password);
      const files = results.flatMap((r) => r.files);
      const errors = results.reduce((n, r) => n + r.errors.length, 0);
      const at = new Date().toISOString();
      this.status.recent = [...files.map((f) => ({ ...f, at })), ...this.status.recent].slice(0, RECENT_LIMIT);
      this.status.lastRun = {
        startedAt, finishedAt: at, ok: errors === 0,
        added: files.filter((f) => !f.updated).length,
        updated: files.filter((f) => f.updated).length,
        errors,
      };
      this.status.state = "idle";
      this.status.message = errors ? `${errors} file(s) failed, see log` : undefined;
      this.failures = 0;
      this.nextRun = Date.now() + intervalMs;
      if (files.length) log(`${files.length} new or updated file(s).`);
    } catch (err) {
      this.failures++;
      const message = (err as Error).message;
      log(`Sync failed: ${message}`);
      this.status = {
        ...this.status,
        state: "error",
        message,
        lastRun: { startedAt, finishedAt: new Date().toISOString(), ok: false, added: 0, updated: 0, errors: 1 },
      };
      // Network is often not up right after wake; retry soon, backing off up to the interval.
      this.nextRun = Date.now() + Math.min(intervalMs, 60_000 * 2 ** this.failures);
    } finally {
      this.running = false;
      if (this.nextRun) log(`Next check at ${new Date(this.nextRun).toLocaleTimeString("de-DE")}.`);
    }
  }
}
