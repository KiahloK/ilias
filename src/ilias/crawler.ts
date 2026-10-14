import { sanitizeName } from "../sync/fsnames.js";
import type { IliasClient } from "./client.js";
import { sessionDate } from "./parse.js";
import type { IliasItem } from "./types.js";

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

export interface CrawlEvent {
  kind: "file" | "dir" | "skipped";
  item: IliasItem;
  /** Directory relative to the course root, using sanitized names. */
  relDir: string;
}

const CONTAINERS = new Set(["fold", "grp", "crs", "sess"]);

/**
 * Walks a course depth-first and yields every folder and file. Sessions are only
 * entered once they have started (their materials are rarely uploaded earlier).
 */
export interface CrawlOptions {
  videos?: boolean;
  now?: Date;
}

export async function* crawl(client: IliasClient, rootRefId: string, { videos = true, now = new Date() }: CrawlOptions = {}): AsyncGenerator<CrawlEvent> {
  const visited = new Set<string>([rootRefId]);
  const nowIso = now.toISOString().slice(0, 16);

  async function* walk(refId: string, relDir: string): AsyncGenerator<CrawlEvent> {
    for (const item of await client.children(refId)) {
      if (visited.has(item.refId)) continue;
      visited.add(item.refId);

      if (item.type === "file") {
        yield { kind: "file", item, relDir };
      } else if (CONTAINERS.has(item.type)) {
        if (item.type === "sess") {
          const date = sessionDate(item.title, now);
          if (date && date > nowIso) continue;
        }
        const dir = join(relDir, sanitizeName(item.title));
        yield { kind: "dir", item, relDir: dir };
        yield* walk(item.refId, dir);
      } else if (item.type === "exc") {
        const dir = join(relDir, sanitizeName(item.title));
        yield { kind: "dir", item, relDir: dir };
        const assignments = await client.assignments(item.refId);
        for (const ass of assignments) {
          // Most exercises have a single assignment; don't nest an extra folder for it.
          const assDir = assignments.length === 1 ? dir : join(dir, sanitizeName(ass.title));
          for (const file of await client.assignmentFiles(item.refId, ass)) {
            yield { kind: "file", item: file, relDir: assDir };
          }
        }
      } else if (item.type === "opencast" && videos) {
        const dir = join(relDir, sanitizeName(item.title));
        yield { kind: "dir", item, relDir: dir };
        for (const episode of await client.opencastEpisodes(item.refId)) {
          yield { kind: "file", item: episode, relDir: dir };
        }
      } else {
        yield { kind: "skipped", item, relDir };
      }
    }
  }

  yield* walk(rootRefId, "");
}
