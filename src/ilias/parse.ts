import * as cheerio from "cheerio";
import type { CourseEntry, IliasItem, ItemType } from "./types.js";

/** Icon labels (de/en) → type; used when the link does not reveal the type. */
const LABEL_TYPES: [RegExp, ItemType][] = [
  [/^(inline )?(datei|file)$/i, "file"],
  [/^(ordner|folder)$/i, "fold"],
  [/^(gruppe|group)$/i, "grp"],
  [/^(kurs|course)$/i, "crs"],
  [/^(sitzung|session)$/i, "sess"],
  [/^(übung|exercise)$/i, "exc"],
  [/^forum$/i, "frm"],
  [/^weblink/i, "webr"],
  [/^mediacast/i, "mcst"],
  [/opencast/i, "opencast"],
  [/^(inhaltsseite|content page)$/i, "copa"],
  [/^(datensammlung|data collection)$/i, "dcl"],
  [/^(kurslink|course link|gruppenlink|group link|kategorielink|category link)$/i, "link"],
];

/** Some ILIAS labels are HTML-escaped twice, so cheerio leaves "&amp;" in the text. */
export const decodeEntities = (s: string) =>
  s.replace(/&(amp|quot|#39|apos|lt|gt);/g, (_, e: string) =>
    ({ amp: "&", quot: '"', "#39": "'", apos: "'", lt: "<", gt: ">" })[e]!);

const GO_TYPES: Record<string, ItemType> = {
  crs: "crs", grp: "grp", fold: "fold", sess: "sess", file: "file", exc: "exc",
  frm: "frm", webr: "webr", copa: "copa", dcl: "dcl", mcst: "mcst", xmh: "opencast", xoct: "opencast",
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mär: 3, mrz: 3, mar: 3, apr: 4, mai: 5, may: 5, jun: 6, jul: 7,
  aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dez: 12, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Normalizes ILIAS date strings ("9. Apr 2024, 18:36", "Heute, 14:30", "Gestern, 12:56")
 * to "YYYY-MM-DDTHH:MM", so relative dates don't look like changes the next day.
 */
export function parseIliasDate(text: string, now = new Date()): string | undefined {
  const t = text.trim();
  const rel = /^(heute|today|gestern|yesterday|morgen|tomorrow),\s*(\d{1,2}):(\d{2})/i.exec(t);
  if (rel) {
    const offset = /gestern|yesterday/i.test(rel[1]) ? -1 : /morgen|tomorrow/i.test(rel[1]) ? 1 : 0;
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    return `${isoDay(d)}T${pad(+rel[2])}:${rel[3]}`;
  }
  const abs = /^(\d{1,2})\.\s*([A-Za-zäÄ]{3})[a-zä]*\.?\s+(\d{4})(?:,\s*(\d{1,2}):(\d{2}))?/.exec(t);
  if (abs) {
    const month = MONTHS[abs[2].toLowerCase()];
    if (!month) return undefined;
    const time = abs[4] ? `T${pad(+abs[4])}:${abs[5]}` : "";
    return `${abs[3]}-${pad(month)}-${pad(+abs[1])}${time}`;
  }
  return undefined;
}

function typeFromUrl(url: string): { type: ItemType; refId: string } | undefined {
  const go = /\/go\/(\w+)\/(\d+)/.exec(url) ?? /goto\.php\?target=([a-z]+)_(\d+)/.exec(url);
  if (go) return { type: GO_TYPES[go[1]] ?? "unknown", refId: go[2] };
  const refId = /[?&]ref_id=(\d+)/.exec(url)?.[1];
  if (!refId) return undefined;
  if (/cmdClass=ilObjFileGUI/i.test(url)) return { type: "file", refId };
  if (/cmdClass=ilObjOpencastGUI/i.test(url)) return { type: "opencast", refId };
  return { type: "unknown", refId };
}

function typeFromLabel(label: string | undefined): ItemType | undefined {
  if (!label) return undefined;
  return LABEL_TYPES.find(([re]) => re.test(label.trim()))?.[1];
}

/** Parses the repository object list of a course/group/folder/session page. */
export function parseContainer(html: string, pageUrl: string, now = new Date()): IliasItem[] {
  const $ = cheerio.load(html);
  const items = new Map<string, IliasItem>();

  $(".ilContainerListItemOuter").each((_, el) => {
    const row = $(el);
    const link = row.find("a.il_ContainerItemTitle").first();
    const href = link.attr("href");
    if (!href) return;
    const url = new URL(href, pageUrl).toString();
    const label = row.find(".ilContainerListItemIcon img").attr("alt");
    const fromUrl = typeFromUrl(url);
    const refId = fromUrl?.refId ?? /lg_div_(\d+)/.exec(row.attr("id") ?? "")?.[1];
    if (!refId || items.has(refId)) return;

    let type = fromUrl?.type ?? "unknown";
    if (type === "unknown") type = typeFromLabel(label) ?? "unknown";

    const props = row
      .find(".il_ItemProperty")
      .map((_, p) => $(p).text().replace(/ /g, " ").trim())
      .get()
      .filter(Boolean);

    const item: IliasItem = { refId, type, title: decodeEntities(link.text().trim()), url, label };

    if (type === "file") {
      const actionsLabel = row.find("button[aria-label]").attr("aria-label") ?? "";
      const named = /^(?:Aktionen für|Actions for)\s+(.+)$/.exec(decodeEntities(actionsLabel))?.[1];
      const ext = props[0] && /^[a-z0-9]{1,6}$/i.test(props[0]) ? props[0] : undefined;
      item.fileName = named ?? (ext && !item.title.toLowerCase().endsWith(`.${ext.toLowerCase()}`)
        ? `${item.title}.${ext}`
        : item.title);
      item.size = props.find((p) => /^[\d.,]+\s*(B|KB|MB|GB)$/i.test(p));
      item.version = props.map((p) => /^Version:\s*(\d+)/i.exec(p)?.[1]).find(Boolean);
      item.modified = props.map((p) => parseIliasDate(p, now)).find(Boolean);
    }
    items.set(refId, item);
  });

  return [...items.values()];
}

/** Parses "Meine Kurse und Gruppen" on the dashboard. */
export function parseMemberships(html: string): CourseEntry[] {
  const $ = cheerio.load(html);
  const out = new Map<string, CourseEntry>();
  $(".il-std-item .il-item-title a").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const m = /\/go\/(crs|grp)\/(\d+)/.exec(href) ?? /goto\.php\?target=(crs|grp)_(\d+)/.exec(href);
    if (!m || out.has(m[2])) return;
    const group = $(a).closest(".il-item-group").children("h3").first().text().trim() || undefined;
    out.set(m[2], { refId: m[2], type: m[1] as "crs" | "grp", title: $(a).text().trim(), group });
  });
  return [...out.values()];
}

/** Session titles start with their date; used to skip sessions that haven't happened yet. */
export function sessionDate(title: string, now = new Date()): string | undefined {
  return parseIliasDate(title.split(/\s+-\s+/)[0], now);
}

export interface Assignment {
  assId: string;
  title: string;
  url: string;
}

/** Assignments listed on an exercise overview (fetch with mode=all, otherwise past ones are hidden). */
export function parseExerciseOverview(html: string, pageUrl: string): Assignment[] {
  const $ = cheerio.load(html);
  const out = new Map<string, Assignment>();
  $(".il-std-item .il-item-title a[href*='ass_id=']").each((_, a) => {
    const url = new URL($(a).attr("href")!, pageUrl).toString();
    const assId = /[?&]ass_id=(\d+)/.exec(url)![1];
    if (!out.has(assId)) out.set(assId, { assId, title: decodeEntities($(a).text().trim()), url });
  });
  return [...out.values()];
}

/** Files attached to an assignment (instructions, and sample solutions if released). */
export function parseAssignmentFiles(html: string, pageUrl: string, keyPrefix: string): IliasItem[] {
  const $ = cheerio.load(html);
  const out = new Map<string, IliasItem>();
  $("a[href*='cmd=download']").each((_, a) => {
    const url = new URL($(a).attr("href")!, pageUrl);
    if (!/^download\w*File$/i.test(url.searchParams.get("cmd") ?? "")) return;
    const fileName = url.searchParams.get("file") ?? $(a).closest(".row").find(".control-label").text().trim();
    if (!fileName || out.has(fileName)) return;
    out.set(fileName, { refId: `${keyPrefix}/${fileName}`, type: "file", title: fileName, fileName, url: url.toString() });
  });
  return [...out.values()];
}

/**
 * Recordings in an Opencast series table. Download links point at the CDN with a
 * token that expires after a few hours, so they must be read fresh on every sync.
 */
export function parseOpencastSeries(html: string, pageUrl: string, now = new Date()): IliasItem[] {
  const $ = cheerio.load(html);
  const out: IliasItem[] = [];
  $("table tr").each((_, tr) => {
    const row = $(tr);
    const download = row.find("a[href*='.mp4']").first().attr("href");
    const episodeLink = row.find("a[href*='cmd=showEpisode']").filter((_, a) => $(a).text().trim() !== "").first();
    if (!download || !episodeLink.length) return;
    const episodeId = /[?&]id=[^&]*?([0-9a-f-]{36})(?:&|$)/.exec(episodeLink.attr("href")!)?.[1];
    if (!episodeId) return;
    const url = new URL(download, pageUrl);
    const title = decodeEntities(episodeLink.text().trim());
    const modified = row.find("td").map((_, td) => parseIliasDate($(td).text(), now)).get().find(Boolean);
    out.push({
      refId: `oc_${episodeId}`,
      type: "file",
      title,
      url: url.toString(),
      fileName: `${modified ? `${modified.slice(0, 10)} ` : ""}${title}.mp4`,
      keepName: true,
      // The media track id changes when Opencast re-publishes the recording.
      version: url.pathname.split("/").slice(-2, -1)[0],
      modified,
    });
  });
  return out;
}
