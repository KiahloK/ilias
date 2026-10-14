import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const SERVICE = "ilias-sync";

/** Account key combines host and username so several ILIAS instances can coexist. */
function account(baseUrl: string, username: string): string {
  return `${username}@${new URL(baseUrl).host}`;
}

export async function getPassword(baseUrl: string, username: string): Promise<string | undefined> {
  try {
    const { stdout } = await run("security", [
      "find-generic-password", "-s", SERVICE, "-a", account(baseUrl, username), "-w",
    ]);
    return stdout.replace(/\n$/, "");
  } catch {
    return undefined;
  }
}

export async function setPassword(baseUrl: string, username: string, password: string): Promise<void> {
  // -U updates an existing entry instead of failing.
  await run("security", [
    "add-generic-password", "-U", "-s", SERVICE, "-a", account(baseUrl, username), "-w", password,
  ]);
}

export async function deletePassword(baseUrl: string, username: string): Promise<void> {
  try {
    await run("security", ["delete-generic-password", "-s", SERVICE, "-a", account(baseUrl, username)]);
  } catch {
    // Not present — nothing to delete.
  }
}
