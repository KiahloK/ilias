/** Makes an ILIAS title safe as a Windows file or folder name. */
export function sanitizeName(name: string): string {
  const cleaned = name
    .normalize("NFC")
    .replace(/[\/\\:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  return cleaned.slice(0, 200) || "_";
}

/** "Blatt01.pdf" + "2026-10-11" → "Blatt01 (2026-10-11).pdf" */
export function versionedName(fileName: string, tag: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) return `${fileName} (${tag})`;
  return `${fileName.slice(0, dot)} (${tag})${fileName.slice(dot)}`;
}

/** Parses the filename from a Content-Disposition header (RFC 5987 filename* preferred). */
export function filenameFromContentDisposition(header: string | null): string | undefined {
  if (!header) return undefined;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (star) return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/.exec(header);
  if (!plain) return undefined;
  const value = plain[2] ?? plain[1].trim();
  // ILIAS sometimes sends UTF-8 bytes in a latin1 header.
  try {
    return Buffer.from(value, "latin1").toString("utf8");
  } catch {
    return value;
  }
}
