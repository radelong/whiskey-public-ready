import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { ImportReview } from "../../shared/types";
import { csvToRecords, toCSV } from "../csv";
import { Badge, Button, Card, EmptyState, PageHeader } from "../components/ui";
import { CellarIcon } from "../components/icons";

const COLUMNS = ["name", "distillery", "category", "age_years", "abv", "size_ml", "purchase_date", "purchase_price", "status", "remaining_pct", "location", "notes"] as const;
const KNOWN = new Set<string>([...COLUMNS, "remaining_ml", "remaining_percent", "remaining"]);
const TEMPLATE = toCSV([
  [...COLUMNS],
  ["Eagle Rare 10 Year", "Buffalo Trace", "Bourbon", "10", "45", "750", "2026-02-14", "39.99", "sealed", "", "Shelf 2", "Gift from Dad"],
  ["Lagavulin 16", "Lagavulin", "Single Malt Scotch", "16", "43", "750", "2025-11-03", "109.99", "open", "65", "Bar cart", "Peaty - special occasions"],
  ["Redbreast 12", "Midleton", "Irish", "12", "40", "750", "", "64.99", "sealed", "", "Closet", ""],
  ["Booker's Batch 2025-01", "Jim Beam", "Bourbon", "7", "62.8", "750", "2026-01-20", "89.99", "open", "80", "Bar cart", "Cask strength"],
  ["Hibiki Japanese Harmony", "Suntory", "Japanese", "", "43", "700", "", "109.99", "sealed", "", "Display", ""],
  ["Nikka Coffey Grain", "Nikka", "Japanese", "", "45", "750", "", "74.99", "finished", "", "", "Loved this - rebuy"],
  ["Weller Special Reserve", "Buffalo Trace", "Bourbon", "", "45", "750", "", "49.99", "sealed", "", "", ""],
]);
const templateHref = "data:text/csv;charset=utf-8," + encodeURIComponent("﻿" + TEMPLATE);
type Result = Awaited<ReturnType<typeof api.importBottles>>;

export default function Import() {
  const [raw, setRaw] = useState("");
  const [review, setReview] = useState<ImportReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const records = useMemo(() => raw.trim() ? csvToRecords(raw) : [], [raw]);
  const headers = useMemo(() => records[0] ? Object.keys(records[0]) : [], [records]);
  const unknownColumns = headers.filter((header) => !KNOWN.has(header));

  function resetReview(value: string) {
    setRaw(value);
    setReview(null);
    setResult(null);
    setError(null);
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) resetReview(await file.text());
  }

  async function runReview() {
    setBusy(true);
    setError(null);
    try {
      setReview(await api.reviewImport(records));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    if (!review || review.blocked) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api.importBottles(records));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Import bottles"
        subtitle="Review spreadsheet rows before anything is added"
        actions={<Link to="/"><Button variant="ghost">Back to Cellar</Button></Link>}
      />

      {result ? (
        <Card>
          <EmptyState
            icon={<CellarIcon />}
            title={"Imported " + result.inserted + " bottle" + (result.inserted === 1 ? "" : "s")}
            action={<Link to="/"><Button variant="primary">View the Cellar</Button></Link>}
          >
            {result.warnings ? result.warnings + " duplicate warning(s) were acknowledged and imported." : "Every reviewed row was imported."}
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card title="1 · Get the template">
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
              Only <strong>name</strong> is required. Prices such as <code>$49.99</code>, ABV such as <code>47%</code>,
              and remaining amounts such as <code>65%</code> are normalized during review. Dates use YYYY-MM-DD.
            </p>
            <a href={templateHref} download="whiskey-cellar-template.csv"><Button variant="secondary">Download CSV template</Button></a>
          </Card>

          <Card title="2 · Upload or paste your CSV">
            <input type="file" accept=".csv,text/csv" onChange={onFile} />
            <div className="or-divider"><span>or paste it</span></div>
            <textarea
              value={raw}
              onChange={(e) => resetReview(e.target.value)}
              placeholder={"name,distillery,category,abv\nBlanton's,Buffalo Trace,Bourbon,46.5%"}
              style={{ minHeight: 120, fontFamily: "ui-monospace, monospace", fontSize: 12 }}
            />
            {records.length > 0 && (
              <Button variant="secondary" loading={busy} onClick={runReview} style={{ marginTop: 12 }}>
                Review {records.length} row{records.length === 1 ? "" : "s"}
              </Button>
            )}
          </Card>

          {records.length > 0 && (
            <Card title={"3 · " + (review ? "Import review" : "CSV preview")}>
              {unknownColumns.length > 0 && (
                <div className="error-text" style={{ color: "var(--text-dim)" }}>
                  Unrecognized columns are ignored: {unknownColumns.join(", ")}
                </div>
              )}

              {review && (
                <div className="import-summary">
                  <Badge kind="open">{review.ready} import-ready</Badge>
                  {review.blocked > 0 && <Badge kind="finished">{review.blocked} blocked</Badge>}
                  {review.warnings > 0 && <Badge kind="pending">{review.warnings} warnings</Badge>}
                </div>
              )}

              <div style={{ overflowX: "auto", marginTop: 10 }}>
                <table className="preview-table review-table">
                  <thead>
                    <tr>
                      <th>Row</th><th>Status</th><th>Name</th><th>Distillery</th><th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(review?.rows ?? records.slice(0, 20).map((input, index) => ({
                      row: index + 2, input, normalized: null, errors: [], warnings: [], ready: false,
                    }))).map((row) => (
                      <tr key={row.row}>
                        <td>{row.row}</td>
                        <td>{review ? (row.ready ? "Ready" : "Needs correction") : "Not reviewed"}</td>
                        <td>{row.input.name}</td>
                        <td>{row.input.distillery}</td>
                        <td className={row.errors.length ? "review-error" : row.warnings.length ? "review-warning" : ""}>
                          {[...row.errors, ...row.warnings].join(" ") || (review ? "Validated" : "Review required")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {review?.blocked ? (
                <div className="error-text">Correct the blocked rows in the CSV, then review it again. No bottles have been added.</div>
              ) : review ? (
                <p className="muted" style={{ fontSize: 12.5 }}>
                  This confirmation writes all {review.ready} reviewed rows. Duplicate warnings stay as separate bottle entries.
                </p>
              ) : (
                <p className="muted" style={{ fontSize: 12.5 }}>Review is read-only. The app will not add bottles until the final confirmation.</p>
              )}

              {error && <div className="error-text">{error}</div>}
              {review && review.blocked === 0 && (
                <Button variant="primary" loading={busy} onClick={confirmImport} style={{ marginTop: 8 }}>
                  Confirm import of {review.ready} bottle{review.ready === 1 ? "" : "s"}
                </Button>
              )}
            </Card>
          )}
        </>
      )}
    </>
  );
}
