export type ItemType =
  | "crs" | "grp" | "fold" | "sess" | "file" | "exc" | "frm" | "webr" | "mcst" | "opencast" | "link" | "copa" | "dcl" | "unknown";

export interface IliasItem {
  refId: string;
  type: ItemType;
  title: string;
  /** Absolute URL of the item's main link. */
  url: string;
  /** Filename incl. extension when ILIAS shows it (files only). */
  fileName?: string;
  version?: string;
  /** ISO-like "2026-10-11T14:30" (relative "Heute"/"Gestern" resolved). */
  modified?: string;
  size?: string;
  /** Use fileName even if the server sends its own name (Opencast sends "composite.mp4"). */
  keepName?: boolean;
  /** Raw localized type label from the icon (for logging unknown types). */
  label?: string;
}

export interface CourseEntry {
  refId: string;
  type: "crs" | "grp";
  title: string;
  /** Dashboard grouping heading, e.g. "Winter 2026/27". */
  group?: string;
}
