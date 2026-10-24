import { execFile } from "node:child_process";
import { access, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface StartupResult {
  /** Where the launcher was written (Startup .cmd on Windows, LaunchAgent plist on macOS). */
  target: string;
  logPath: string;
  /** macOS only: whether the bundled menu-bar app (built via `macos/build.sh`) was also installed. */
  appInstalled?: boolean;
}

function projectDir(): string {
  // Runs the compiled CLI (dist/cli.js) next to this module, not the TypeScript sources.
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

async function compiledCli(): Promise<string> {
  const cli = join(projectDir(), "dist", "cli.js");
  await access(cli).catch(() => {
    throw new Error(`${cli} not found — run \`npm run build\` first.`);
  });
  return cli;
}

export async function installStartup(): Promise<StartupResult> {
  return process.platform === "darwin" ? installMacLaunchAgent() : installWindowsStartup();
}

export async function uninstallStartup(): Promise<void> {
  return process.platform === "darwin" ? uninstallMacLaunchAgent() : uninstallWindowsStartup();
}

// ---------- Windows: per-user Startup-folder launcher ----------

const WIN_STARTUP_DIR = join(
  process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
  "Microsoft", "Windows", "Start Menu", "Programs", "Startup",
);
const WIN_STARTUP_FILE = join(WIN_STARTUP_DIR, "ILIAS Sync.cmd");
const WIN_LOG_PATH = join(homedir(), ".config", "ilias-sync", "ilias-sync.log");

async function installWindowsStartup(): Promise<StartupResult> {
  const cli = await compiledCli();
  await mkdir(WIN_STARTUP_DIR, { recursive: true });
  await mkdir(dirname(WIN_LOG_PATH), { recursive: true });
  const command = [
    "@echo off",
    `cd /d ${quote(projectDir())}`,
    `${quote(process.execPath)} ${quote(cli)} watch >> ${quote(WIN_LOG_PATH)} 2>&1`,
    "",
  ].join("\r\n");
  await writeFile(WIN_STARTUP_FILE, command, "utf8");
  return { target: WIN_STARTUP_FILE, logPath: WIN_LOG_PATH };
}

async function uninstallWindowsStartup(): Promise<void> {
  await rm(WIN_STARTUP_FILE, { force: true });
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

// ---------- macOS: LaunchAgent ----------

const LABEL = "de.ilias-sync.watch";
const APP_LABEL = "de.ilias-sync.app";
const agentsDir = join(homedir(), "Library", "LaunchAgents");
const plistPath = join(agentsDir, `${LABEL}.plist`);
const appPlistPath = join(agentsDir, `${APP_LABEL}.plist`);
export const MAC_APP_PATH = join(homedir(), "Applications", "ILIAS Sync.app");
const MAC_LOG_PATH = join(homedir(), "Library", "Logs", "ilias-sync.log");
const domain = () => `gui/${process.getuid!()}`;

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Prefer Homebrew's stable symlink over the versioned Cellar path, which changes on upgrades. */
async function nodePath(): Promise<string> {
  for (const candidate of ["/opt/homebrew/bin/node", "/usr/local/bin/node"]) {
    if (await access(candidate).then(() => true, () => false)) return candidate;
  }
  return process.execPath;
}

async function installMacLaunchAgent(): Promise<StartupResult> {
  const dir = projectDir();
  const cli = await compiledCli();

  await mkdir(dirname(MAC_LOG_PATH), { recursive: true });
  await loadAgent(LABEL, plistPath, [await nodePath(), cli, "watch"], {
    WorkingDirectory: dir,
    KeepAlive: true,
    ThrottleInterval: 60,
    StandardOutPath: MAC_LOG_PATH,
    StandardErrorPath: MAC_LOG_PATH,
  });

  // The menu-bar app is optional: only installed if it has been built (`macos/build.sh`).
  let appInstalled = false;
  const builtApp = join(dir, "macos", "build", "ILIAS Sync.app");
  if (await access(builtApp).then(() => true, () => false)) {
    await run("pkill", ["-x", "ILIASSync"]).catch(() => {});
    await rm(MAC_APP_PATH, { recursive: true, force: true });
    await mkdir(dirname(MAC_APP_PATH), { recursive: true });
    await cp(builtApp, MAC_APP_PATH, { recursive: true });
    // `open` launches it like a normal app; no KeepAlive, so "Quit" really quits it.
    await loadAgent(APP_LABEL, appPlistPath, ["/usr/bin/open", "-a", MAC_APP_PATH], {});
    appInstalled = true;
  }
  return { target: plistPath, logPath: MAC_LOG_PATH, appInstalled };
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

async function uninstallMacLaunchAgent(): Promise<void> {
  for (const [label, path] of [[LABEL, plistPath], [APP_LABEL, appPlistPath]] as const) {
    await stopAgent(label);
    await rm(path, { force: true });
  }
  await run("pkill", ["-x", "ILIASSync"]).catch(() => {});
  await rm(MAC_APP_PATH, { recursive: true, force: true });
}
