import { execFile } from "node:child_process";
import { access, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const LABEL = "de.ilias-sync.watch";
const APP_LABEL = "de.ilias-sync.app";
const agentsDir = join(homedir(), "Library", "LaunchAgents");
const plistPath = join(agentsDir, `${LABEL}.plist`);
const appPlistPath = join(agentsDir, `${APP_LABEL}.plist`);
export const APP_PATH = join(homedir(), "Applications", "ILIAS Sync.app");
const logPath = join(homedir(), "Library", "Logs", "ilias-sync.log");
const domain = () => `gui/${process.getuid!()}`;

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Prefer Homebrew's stable symlink over the versioned Cellar path, which changes on upgrades. */
async function nodePath(): Promise<string> {
  for (const candidate of ["/opt/homebrew/bin/node", "/usr/local/bin/node"]) {
    if (await access(candidate).then(() => true, () => false)) return candidate;
  }
  return process.execPath;
}

export async function installLaunchAgent(): Promise<{ plistPath: string; logPath: string; appInstalled: boolean }> {
  // Runs the compiled CLI (dist/cli.js) next to this module, not the TypeScript sources.
  const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const cli = join(projectDir, "dist", "cli.js");
  try {
    await access(cli);
  } catch {
    throw new Error(`${cli} not found — run \`npm run build\` first.`);
  }

  await mkdir(dirname(logPath), { recursive: true });
  await loadAgent(LABEL, plistPath, [await nodePath(), cli, "watch"], {
    WorkingDirectory: projectDir,
    KeepAlive: true,
    ThrottleInterval: 60,
    StandardOutPath: logPath,
    StandardErrorPath: logPath,
  });

  // The menu bar app is optional: only installed if it has been built (`npm run build:app`).
  let appInstalled = false;
  const builtApp = join(projectDir, "macos", "build", "ILIAS Sync.app");
  if (await access(builtApp).then(() => true, () => false)) {
    await run("pkill", ["-x", "ILIASSync"]).catch(() => {});
    await rm(APP_PATH, { recursive: true, force: true });
    await mkdir(dirname(APP_PATH), { recursive: true });
    await cp(builtApp, APP_PATH, { recursive: true });
    // `open` launches it like a normal app; no KeepAlive, so "Quit" really quits it.
    await loadAgent(APP_LABEL, appPlistPath, ["/usr/bin/open", "-a", APP_PATH], {});
    appInstalled = true;
  }
  return { plistPath, logPath, appInstalled };
}

type PlistValue = string | number | boolean;

function plistValue(v: PlistValue): string {
  if (typeof v === "boolean") return v ? "<true/>" : "<false/>";
  if (typeof v === "number") return `<integer>${v}</integer>`;
  return `<string>${escapeXml(v)}</string>`;
}

/** Writes a LaunchAgent plist and (re)loads it; RunAtLoad starts it right away and at every login. */
async function loadAgent(label: string, path: string, args: string[], extra: Record<string, PlistValue>): Promise<void> {
  const entries = { RunAtLoad: true, ProcessType: "Background", ...extra };
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${escapeXml(a)}</string>`).join("\n")}
  </array>
${Object.entries(entries).map(([k, v]) => `  <key>${k}</key>${plistValue(v)}`).join("\n")}
</dict>
</plist>
`;
  await mkdir(agentsDir, { recursive: true });
  await stopAgent(label);
  await writeFile(path, plist);
  // bootstrap can still fail briefly after a bootout ("5: Input/output error"); retry.
  for (let attempt = 1; ; attempt++) {
    try {
      await run("launchctl", ["bootstrap", domain(), path]);
      return;
    } catch (err) {
      if (attempt >= 5) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

/** Unloads an agent and waits until launchd has actually removed it (bootout returns early). */
async function stopAgent(label: string): Promise<void> {
  await run("launchctl", ["bootout", `${domain()}/${label}`]).catch(() => {});
  for (let i = 0; i < 20; i++) {
    const loaded = await run("launchctl", ["print", `${domain()}/${label}`]).then(() => true, () => false);
    if (!loaded) return;
    await new Promise((r) => setTimeout(r, 250));
  }
}

export async function uninstallLaunchAgent(): Promise<void> {
  for (const [label, path] of [[LABEL, plistPath], [APP_LABEL, appPlistPath]]) {
    await stopAgent(label);
    await rm(path, { force: true });
  }
  await run("pkill", ["-x", "ILIASSync"]).catch(() => {});
  await rm(APP_PATH, { recursive: true, force: true });
}
