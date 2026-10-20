import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

/** Overridable for tests. */
export const CONFIG_DIR = process.env.ILIAS_SYNC_CONFIG_DIR ?? join(homedir(), ".config", "ilias-sync");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");

const CourseSchema = z.object({
  refId: z.string(),
  title: z.string(),
  targetDir: z.string(),
  /** Download Opencast lecture recordings (large: ~500 MB each). */
  videos: z.boolean().default(true),
});

export const ConfigSchema = z.object({
  baseUrl: z.url(),
  username: z.string().min(1),
  intervalMinutes: z.number().positive().default(30),
  concurrency: z.number().int().positive().default(3),
  /** Default parent folder for newly added courses. */
  baseDir: z.string().optional(),
  courses: z.array(CourseSchema).default([]),
});

export type CourseConfig = z.infer<typeof CourseSchema>;
export type Config = z.infer<typeof ConfigSchema>;

export async function loadConfig(path = CONFIG_PATH): Promise<Config> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(`No config found at ${path}. Run \`ilias-sync setup\` first.`);
  }
  return ConfigSchema.parse(JSON.parse(raw));
}

export async function saveConfig(config: Config, path = CONFIG_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(ConfigSchema.parse(config), null, 2) + "\n");
}
