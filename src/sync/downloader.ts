import { createWriteStream } from "node:fs";
import { access, mkdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { HttpClient } from "../http.js";
import { filenameFromContentDisposition, versionedName } from "./fsnames.js";

export async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

/**
 * Starts a download and returns the server-provided filename before writing,
 * so the caller can decide the final path (extension comes from the server).
 */
export async function openDownload(http: HttpClient, url: string) {
  const res = await http.request(url);
  if (!res.ok || !res.body) throw new Error(`Download ${url} failed: ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("text/html")) {
    await res.body.cancel();
    throw new Error(`Download ${url} returned an HTML page (permission denied or session expired?)`);
  }
  return {
    filename: filenameFromContentDisposition(res.headers.get("content-disposition")),
    size: Number(res.headers.get("content-length")) || undefined,
    async saveTo(path: string): Promise<void> {
      await mkdir(dirname(path), { recursive: true });
      const part = `${path}.part`;
      try {
        await pipeline(Readable.fromWeb(res.body as WebReadableStream), createWriteStream(part));
        await rename(part, path);
      } catch (err) {
        await rm(part, { force: true });
        throw err;
      }
    },
  };
}

/** Moves an outdated local copy aside: "Blatt01.pdf" → "Blatt01 (2026-10-11).pdf". */
export async function archiveExisting(path: string, tag: string): Promise<string | undefined> {
  if (!(await exists(path))) return undefined;
  const aside = (t: string) => join(dirname(path), versionedName(basename(path), t));
  let target = aside(tag);
  for (let i = 2; await exists(target); i++) target = aside(`${tag} ${i}`);
  await rename(path, target);
  return target;
}
