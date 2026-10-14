import { execFile } from "node:child_process";
import { type Config } from "./config.js";
import { sleep } from "./http.js";
import { IliasClient } from "./ilias/client.js";
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

function notify(title: string, message: string): void {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  execFile("osascript", ["-e", `display notification "${esc(message)}" with title "${esc(title)}"`], () => {});
}

/**
 * Syncs now and then whenever the interval has elapsed. Wall-clock time is checked
 * every minute instead of sleeping for the whole interval, so a sync runs shortly
 * after the Mac wakes up (timers don't advance during sleep). The config is
 * re-read on every run, so `ilias-sync courses` takes effect without a restart.
 */
export async function watch(
  getConfig: () => Promise<Config>,
  getPassword: (config: Config) => Promise<string>,
  intervalOverride?: number,
): Promise<never> {
  let failures = 0;
  let nextRun = 0;
  for (;;) {
    if (Date.now() >= nextRun) {
      let intervalMs = 30 * 60_000;
      try {
        const config = await getConfig();
        intervalMs = (intervalOverride ?? config.intervalMinutes) * 60_000;
        const results = await syncAll(config, await getPassword(config));
        failures = 0;
        nextRun = Date.now() + intervalMs;
        const changed = results.flatMap((r) => [...r.added, ...r.updated]);
        if (changed.length) {
          notify("ILIAS Sync", changed.length === 1 ? `Neu: ${changed[0]}` : `${changed.length} neue/aktualisierte Dateien`);
        }
      } catch (err) {
        failures++;
        log(`Sync failed: ${(err as Error).message}`);
        // Network is often not up right after wake; retry soon, backing off up to the interval.
        nextRun = Date.now() + Math.min(intervalMs, 60_000 * 2 ** failures);
      }
      log(`Next check at ${new Date(nextRun).toLocaleTimeString("de-DE")}.`);
    }
    await sleep(60_000);
  }
}
