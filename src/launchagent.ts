import { execFile } from "node:child_process";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const LABEL = "de.ilias-sync.watch";
const plistPath = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
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

export async function installLaunchAgent(): Promise<{ plistPath: string; logPath: string }> {
  // Runs the compiled CLI (dist/cli.js) next to this module, not the TypeScript sources.
  const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const cli = join(projectDir, "dist", "cli.js");
  try {
    await access(cli);
  } catch {
    throw new Error(`${cli} not found — run \`npm run build\` first.`);
  }

  const args = [await nodePath(), cli, "watch"];
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${escapeXml(a)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key><string>${escapeXml(projectDir)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>60</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key><string>${escapeXml(logPath)}</string>
</dict>
</plist>
`;
  await mkdir(dirname(plistPath), { recursive: true });
  await mkdir(dirname(logPath), { recursive: true });
  await run("launchctl", ["bootout", `${domain()}/${LABEL}`]).catch(() => {}); // replace a previous install
  await writeFile(plistPath, plist);
  await run("launchctl", ["bootstrap", domain(), plistPath]);
  return { plistPath, logPath };
}

export async function uninstallLaunchAgent(): Promise<void> {
  await run("launchctl", ["bootout", `${domain()}/${LABEL}`]).catch(() => {});
  await rm(plistPath, { force: true });
}
