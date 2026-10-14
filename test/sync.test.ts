import { readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { IliasClient } from "../src/ilias/client.js";
import { syncCourse } from "../src/sync/sync.js";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");

/** Minimal fake ILIAS: one course containing the "Folien" folder from the fixtures. */
let server: Server;
let base: string;
let folderHtml: string;
let fileBody = "v1";
let fileRequests = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, base);
    const rewrite = (html: string) => html.replaceAll("https://ilias3.uni-stuttgart.de/", base);
    if (url.pathname === "/login.php") return res.end(rewrite(fixture("login.html")));
    if (req.method === "POST") return res.end('<a href="logout.php">Abmelden</a>');
    if (url.searchParams.get("cmd") === "sendfile") {
      fileRequests++;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="file_${url.searchParams.get("ref_id")}.pdf"`);
      return res.end(fileBody);
    }
    const refId = url.searchParams.get("ref_id");
    if (refId === "1") {
      return res.end(`<a href="logout.php">x</a><div class="ilContainerListItemOuter" id="lg_div_3689497">
        <div class="ilContainerListItemIcon"><img alt="Ordner"></div>
        <a class="il_ContainerItemTitle" href="${base}go/fold/3689497">Folien: Teil 1</a></div>`);
    }
    if (refId === "3689497") return res.end(rewrite(folderHtml));
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
afterAll(() => server.close());

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ilias-sync-test-"));
  folderHtml = fixture("folder.html");
  fileBody = "v1";
  fileRequests = 0;
  return () => rm(dir, { recursive: true, force: true });
});

const course = () => ({ refId: "1", title: "Test", targetDir: dir });

describe("syncCourse", () => {
  it("downloads everything once, then nothing, then versions changed files", async () => {
    const client = new IliasClient(base, "u", "p");
    await client.login();

    const first = await syncCourse(client, course());
    expect(first.errors).toEqual([]);
    expect(first.added).toHaveLength(42);
    const folder = join(dir, "Folien_ Teil 1");
    expect(await readFile(join(folder, "file_3712026.pdf"), "utf8")).toBe("v1");

    const second = await syncCourse(client, course());
    expect(second.added).toHaveLength(0);
    expect(second.unchanged).toBe(42);
    expect(fileRequests).toBe(42);

    // ILIAS shows a new version of one file.
    folderHtml = folderHtml.replace("9. Apr 2024, 18:36", "Heute, 10:00");
    fileBody = "v2";
    const third = await syncCourse(client, course());
    expect(third.updated).toHaveLength(1);
    expect(await readFile(join(folder, "file_3712026.pdf"), "utf8")).toBe("v2");
    expect(await readFile(join(folder, "file_3712026 (2024-04-09).pdf"), "utf8")).toBe("v1");
    expect((await readdir(folder)).filter((f) => f.endsWith(".part"))).toEqual([]);
  });

  it("dry run writes nothing", async () => {
    const client = new IliasClient(base, "u", "p");
    await client.login();
    const r = await syncCourse(client, course(), { dryRun: true });
    expect(r.added).toHaveLength(42);
    expect(fileRequests).toBe(0);
    expect(await readdir(dir).catch(() => [])).toEqual([]);
  });
});
