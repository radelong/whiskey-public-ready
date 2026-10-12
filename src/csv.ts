// Small dependency-free CSV parser/formatter. Handles quoted fields with
// embedded commas / newlines / doubled quotes, CRLF, and a leading BOM —
// which covers Excel, Numbers, and Google Sheets exports.

export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;

  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
    } else if (ch === ",") {
      pushField();
      i++;
    } else if (ch === "\r") {
      i++; // handled by the \n that follows
    } else if (ch === "\n") {
      pushRow();
      i++;
    } else {
      field += ch;
      i++;
    }
  }
  // trailing field / row (unless the file ended on a clean newline)
  if (field !== "" || row.length > 0) pushRow();

  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Turn CSV rows into a list of objects keyed by the (normalised) header row. */
export function csvToRecords(text: string): Record<string, string>[] {
  const rows = parseCSV(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  return rows.slice(1).map((cells) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h) rec[h] = (cells[i] ?? "").trim();
    });
    return rec;
  });
}

export function toCSV(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((r) =>
      r
        .map((v) => {
          const s = v == null ? "" : String(v);
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\r\n");
}
