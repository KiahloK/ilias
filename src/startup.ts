import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const STARTUP_DIR = join(
  process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
  "Microsoft", "Windows", "Start Menu", "Programs", "Startup",
);
const STARTUP_FILE = join(STARTUP_DIR, "ILIAS Sync.cmd");
const LOG_PATH = join(homedir(), ".config", "ilias-sync", "ilias-sync.log");

export async function installStartup(): Promise<{ startupFile: string; logPath: string }> {
  const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const cli = join(projectDir, "dist", "cli.js");
  await access(cli).catch(() => {
    throw new Error(`${cli} not found — run \`npm run build\` first.`);
  });

  await mkdir(STARTUP_DIR, { recursive: true });
  await mkdir(dirname(LOG_PATH), { recursive: true });
  const command = [
    "@echo off",
    `cd /d ${quote(projectDir)}`,
    `${quote(process.execPath)} ${quote(cli)} watch >> ${quote(LOG_PATH)} 2>&1`,
    "",
  ].join("\r\n");
  await writeFile(STARTUP_FILE, command, "utf8");
  return { startupFile: STARTUP_FILE, logPath: LOG_PATH };
}

export async function uninstallStartup(): Promise<void> {
  await rm(STARTUP_FILE, { force: true });
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
