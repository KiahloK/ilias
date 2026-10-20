import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import pLimit from "p-limit";
import type { CourseConfig } from "../config.js";
import type { IliasClient } from "../ilias/client.js";
import { crawl } from "../ilias/crawler.js";
import { decodeEntities } from "../ilias/parse.js";
import type { IliasItem } from "../ilias/types.js";
import { archiveExisting, exists, openDownload } from "./downloader.js";
import { sanitizeName } from "./fsnames.js";
import { type FileState, SyncState } from "./state.js";

export interface SyncResult {
  course: string;
  added: string[];
  updated: string[];
  /** Absolute paths of new/updated files, for the menu bar app. */
  files: { label: string; path: string; updated: boolean }[];
  unchanged: number;
  skippedTypes: Record<string, number>;
  errors: string[];
}

export interface SyncOptions {
  dryRun?: boolean;
  concurrency?: number;
  videos?: boolean;
  log?: (msg: string) => void;
}

function isUnchanged(prev: FileState, item: IliasItem): boolean {
  return prev.version === item.version && prev.modified === item.modified && prev.size === item.size;
}

export async function syncCourse(client: IliasClient, course: CourseConfig, opts: SyncOptions = {}): Promise<SyncResult> {
  const log = opts.log ?? (() => {});
  const root = course.targetDir;
  const state = await SyncState.load(root);
  const limit = pLimit(opts.concurrency ?? 3);
  const result: SyncResult = { course: course.title, added: [], updated: [], files: [], unchanged: 0, skippedTypes: {}, errors: [] };
  const claimedPaths = new Set<string>(); // paths assigned during this run, to resolve name clashes
  const jobs: Promise<void>[] = [];

  if (!opts.dryRun) await mkdir(root, { recursive: true });

  for await (const event of crawl(client, course.refId, { videos: opts.videos ?? course.videos })) {
    const { item, relDir } = event;
    if (event.kind === "skipped") {
      result.skippedTypes[item.type] = (result.skippedTypes[item.type] ?? 0) + 1;
      if (item.type === "unknown") log(`  ? unknown item "${item.title}" (${item.label ?? "no label"})`);
      continue;
    }
    if (event.kind === "dir") {
      if (!opts.dryRun && item.type !== "sess") await mkdir(join(root, relDir), { recursive: true });
      continue;
    }

    const prev = state.get(item.refId);
    if (prev && isUnchanged(prev, item) && (await exists(join(root, prev.localPath)))) {
      claimedPaths.add(prev.localPath);
      result.unchanged++;
      continue;
    }

    jobs.push(limit(async () => {
      try {
        const download = opts.dryRun ? undefined : await openDownload(client.http, item.url);
        const serverName = item.keepName ? undefined : download?.filename;
        const baseName = sanitizeName(decodeEntities(serverName ?? item.fileName ?? item.title));
        let relPath = relDir ? `${relDir}/${baseName}` : baseName;
        if (claimedPaths.has(relPath) && prev?.localPath !== relPath) {
          relPath = relPath.replace(/(\.[^./]+)?$/, ` [${item.refId}]$1`);
        }
        claimedPaths.add(relPath);

        const label = `${course.title}/${relPath}`;
        if (opts.dryRun) {
          log(`  ${prev ? "~" : "+"} ${relPath}`);
        } else {
          // Keep the previous copy (e.g. with your annotations) under a dated name.
          const tag = (prev?.modified ?? prev?.downloadedAt ?? new Date().toISOString()).slice(0, 10);
          if (prev) await archiveExisting(join(root, prev.localPath), tag);
          await archiveExisting(join(root, relPath), tag);
          await download!.saveTo(join(root, relPath));
          state.set(item.refId, {
            localPath: relPath,
            version: item.version,
            modified: item.modified,
            size: item.size,
            downloadedAt: new Date().toISOString(),
          });
          log(`  ${prev ? "~ updated" : "+ new"}: ${relPath}`);
        }
        (prev ? result.updated : result.added).push(label);
        if (!opts.dryRun) result.files.push({ label, path: join(root, relPath), updated: !!prev });
      } catch (err) {
        result.errors.push(`${item.title}: ${(err as Error).message}`);
        log(`  ! ${item.title}: ${(err as Error).message}`);
      }
    }));
  }

  await Promise.all(jobs);
  if (!opts.dryRun) await state.save();
  return result;
}
