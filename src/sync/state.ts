import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface FileState {
  /** Path relative to the course target directory. */
  localPath: string;
  version?: string;
  modified?: string;
  size?: string;
  downloadedAt: string;
}

const STATE_FILE = ".ilias-sync-state.json";

/** Per-course record of what has been downloaded, keyed by a stable ILIAS item key. */
export class SyncState {
  private constructor(private readonly dir: string, private readonly files: Record<string, FileState>) {}

  static async load(courseDir: string): Promise<SyncState> {
    try {
      const raw = await readFile(join(courseDir, STATE_FILE), "utf8");
      return new SyncState(courseDir, JSON.parse(raw).files ?? {});
    } catch {
      return new SyncState(courseDir, {});
    }
  }

  get(key: string): FileState | undefined {
    return this.files[key];
  }

  set(key: string, state: FileState): void {
    this.files[key] = state;
  }

  async save(): Promise<void> {
    const path = join(this.dir, STATE_FILE);
    await writeFile(`${path}.tmp`, JSON.stringify({ files: this.files }, null, 2));
    await rename(`${path}.tmp`, path);
  }
}
