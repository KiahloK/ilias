import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAssignmentFiles, parseContainer, parseExerciseOverview, parseIliasDate, parseMemberships, parseOpencastSeries, parseSemester, sortCourses } from "../src/ilias/parse.js";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
const BASE = "https://ilias3.uni-stuttgart.de/";
const NOW = new Date(2026, 9, 11, 12, 0);

describe("parseIliasDate", () => {
  it("parses absolute German dates", () => {
    expect(parseIliasDate("9. Apr 2024, 18:36")).toBe("2024-04-09T18:36");
    expect(parseIliasDate("2. Mai 2024, 11:16")).toBe("2024-05-02T11:16");
    expect(parseIliasDate("15. Okt 2026, 15:45")).toBe("2026-10-15T15:45");
  });
  it("resolves relative dates", () => {
    expect(parseIliasDate("Heute, 14:30", NOW)).toBe("2026-10-11T14:30");
    expect(parseIliasDate("Gestern, 12:56", NOW)).toBe("2026-10-10T12:56");
  });
  it("ignores non-dates", () => {
    expect(parseIliasDate("Anzahl Seiten: 22")).toBeUndefined();
  });
});

describe("parseMemberships", () => {
  const courses = parseMemberships(fixture("dashboard.html"));
  it("finds all courses and groups", () => {
    expect(courses).toHaveLength(45);
    expect(courses).toContainEqual({
      refId: "4553293",
      type: "crs",
      title: "Introduction to Modern Cryptography [Vorlesung]",
      group: "Winter 2026/27",
    });
    expect(courses.find((c) => c.refId === "3917569")?.type).toBe("grp");
  });
});

describe("parseContainer", () => {
  it("parses a course page", () => {
    const items = parseContainer(fixture("course.html"), BASE, NOW);
    const byId = (id: string) => items.find((i) => i.refId === id);
    expect(byId("4615303")).toMatchObject({ type: "fold", title: "Slides" });
    expect(byId("4615298")).toMatchObject({ type: "opencast", title: "Lecture Recordings" });
    expect(byId("4615304")?.type).toBe("exc");
    expect(byId("4615896")?.type).toBe("frm");
    expect(byId("4615931")?.type).toBe("sess");
    expect(items.filter((i) => i.type === "unknown")).toEqual([]);
  });

  it("parses files with metadata", () => {
    const items = parseContainer(fixture("folder.html"), BASE, NOW);
    expect(items).toHaveLength(42);
    expect(items.every((i) => i.type === "file")).toBe(true);
    expect(items[0]).toMatchObject({
      refId: "3712026",
      fileName: "TI2-folien01_annotationen.pdf",
      size: "1.6 MB",
      modified: "2024-04-09T18:36",
      version: undefined,
    });
    expect(items.find((i) => i.refId === "3742022")).toMatchObject({
      fileName: "TI2-folien06_annotationen.pdf",
      version: "3",
      modified: "2024-05-02T11:17",
    });
    expect(items[0].url).toContain("cmd=sendfile&ref_id=3712026");
  });
});

describe("exercises", () => {
  it("lists assignments", () => {
    const list = parseExerciseOverview(fixture("exercise.html"), BASE);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ assId: "108042", title: "Assignment 1: Introduction - Intelligent Agent - Classical Search" });
  });
  it("finds assignment files", () => {
    const files = parseAssignmentFiles(fixture("assignment.html"), BASE, "exc_3899540_108042");
    expect(files).toEqual([expect.objectContaining({
      refId: "exc_3899540_108042/Exercise_01.pdf",
      type: "file",
      fileName: "Exercise_01.pdf",
    })]);
    expect(files[0].url).toContain("cmd=downloadFile");
  });
  it("decodes double-escaped titles", () => {
    const html = `<div class="ilContainerListItemOuter"><a class="il_ContainerItemTitle" href="/go/fold/9">Q&amp;amp;A</a></div>`;
    expect(parseContainer(html, BASE)[0].title).toBe("Q&A");
  });
});

describe("parseOpencastSeries", () => {
  it("lists recordings with direct mp4 links", () => {
    const eps = parseOpencastSeries(fixture("opencast-series.html"), BASE, NOW);
    expect(eps).toHaveLength(21);
    expect(eps[0]).toMatchObject({
      refId: "oc_1ea39c85-cbf2-416c-b2e5-677ed60c01f8",
      title: "Recap Session 03",
      fileName: "2025-02-06 Recap Session 03.mp4",
      modified: "2025-02-06T11:24",
      version: "ac11271e-653c-48c8-80bf-028a11c2ffdf",
      keepName: true,
    });
    expect(eps[0].url).toMatch(/^https:\/\/occdn1\.tik\.uni-stuttgart\.de\/.*composite\.mp4\?token=/);
    expect(new Set(eps.map((e) => e.refId)).size).toBe(21);
  });
});

describe("semester sorting", () => {
  it("parses semester headings", () => {
    expect(parseSemester("Winter 2026/27")).toEqual({ start: 2026 * 12 + 10, label: "WS 26/27" });
    expect(parseSemester("Sommer 2026")?.label).toBe("SS 26");
    expect(parseSemester("Summer term 2025")?.label).toBe("SS 25");
    expect(parseSemester("Arbeitsgruppen")).toBeUndefined();
  });

  it("puts the newest semester first and other groups last", () => {
    const groups = [...new Set(sortCourses(parseMemberships(fixture("dashboard.html"))).map((c) => c.group))];
    expect(groups.slice(0, 7)).toEqual([
      "Winter 2026/27", "Sommer 2026", "Winter 2025/26", "Sommer 2025", "Winter 2024/25", "Sommer 2024", "Sommer 2023",
    ]);
    const rest = groups.slice(7);
    expect(rest.every((g) => !parseSemester(g))).toBe(true);
    expect(rest).toEqual([...rest].sort((a, b) => (a ?? "~").localeCompare(b ?? "~", "de")));
  });
});
