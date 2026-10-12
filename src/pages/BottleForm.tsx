import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import type { BottleCandidate, BottleInput, BottleStatus } from "../../shared/types";
import type { FlavorTag } from "../../shared/types";
import { FLAVOR_LABELS, FLAVOR_TAGS } from "../../shared/flavors";
import { Button, Card, Field, PageHeader, useToast } from "../components/ui";
import { CellarIcon, SearchIcon, SparkleIcon } from "../components/icons";
import { compressBottlePhoto } from "../bottle-photo";

const CATEGORIES = [
  "Bourbon",
  "Rye",
  "Single Malt Scotch",
  "Blended Scotch",
  "Irish",
  "Japanese",
  "Canadian",
  "Tennessee",
  "World / Other",
];

const EMPTY: BottleInput = { name: "", size_ml: 750, status: "sealed" };

export default function BottleForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState<BottleInput>(EMPTY);
  const [loadedVersion, setLoadedVersion] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [flavorBusy, setFlavorBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    api
      .bottle(id)
      .then((b) => {
        setF(b);
        setLoadedVersion(b.version);
      })
      .catch((e) => setErr((e as Error).message));
  }, [id]);

  function set<K extends keyof BottleInput>(k: K, v: BottleInput[K]) {
    setF((prev) => ({ ...prev, [k]: v }));
  }
  const num = (v: string) => (v === "" ? null : Number(v));

  const bottleSize = f.size_ml ?? 750;
  const fillPct =
    f.remaining_ml != null ? Math.round((f.remaining_ml / bottleSize) * 100) : 100;

  function setStatus(s: BottleStatus) {
    setF((p) => ({
      ...p,
      status: s,
      remaining_ml: s === "sealed" ? null : s === "finished" ? 0 : (p.remaining_ml ?? p.size_ml ?? 750),
    }));
  }
  function setFillPct(pct: number) {
    setF((p) => ({ ...p, remaining_ml: Math.round(((p.size_ml ?? 750) * pct) / 100) }));
  }

  async function addPhoto(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErr("Choose an image file.");
      return;
    }
    setPhotoBusy(true);
    setErr(null);
    try {
      set("photo_url", await compressBottlePhoto(file));
      toast("Photo added");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setPhotoBusy(false);
    }
  }

  async function lookupFlavorProfile() {
    if (!id) {
      toast("Save the bottle first, then look up its flavor profile");
      return;
    }
    setFlavorBusy(true);
    try {
      const result = await api.lookupFlavorProfile(Number(id));
      if (!result.found || !result.flavor_profile) {
        toast("No usable WhiskyCast review was found; you can enter the profile manually");
        return;
      }
      setF((current) => ({
        ...current,
        flavor_profile: result.flavor_profile,
        flavor_source: result.flavor_source,
        flavor_source_url: result.flavor_source_url,
      }));
      toast("Structured flavor tags found. Review them and save the bottle.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setFlavorBusy(false);
    }
  }

  function setFlavorStrength(tag: FlavorTag, value: string) {
    const next = { ...(f.flavor_profile ?? {}) };
    if (value) next[tag] = Number(value) as 1 | 2 | 3;
    else delete next[tag];
    setF((current) => ({
      ...current,
      flavor_profile: Object.keys(next).length ? next : null,
      flavor_source: Object.keys(next).length ? "Manual" : null,
      flavor_source_url: null,
    }));
  }

  function applyCandidate(c: BottleCandidate) {
    setF((prev) => ({
      ...prev,
      name: c.name || prev.name,
      distillery: c.distillery ?? prev.distillery,
      category: c.category ?? prev.category,
      age_years: c.age_years ?? prev.age_years,
      size_ml: c.size_ml ?? prev.size_ml ?? 750,
      notes: c.notes ?? prev.notes,
      photo_url: c.photo_url ?? prev.photo_url,
      barcode: c.barcode ?? prev.barcode,
      source_url: c.source_url ?? prev.source_url,
    }));
    toast(`Filled from ${c.source}`);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      if (editing) {
        const updated = await api.updateBottle(Number(id), f, loadedVersion ?? -1);
        setLoadedVersion(updated.version);
      }
      else await api.createBottle(f);
      toast(editing ? "Saved" : "Bottle added");
      nav(editing ? `/bottle/${id}` : "/");
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Archive "${f.name}"? Its bottle image and tasting history will be kept.`)) return;
    await api.deleteBottle(Number(id));
    toast("Bottle archived; its tasting history and image were kept");
    nav("/");
  }

  return (
    <>
      <PageHeader title={editing ? "Edit bottle" : "Add a bottle"} />

      {!editing && <OnlineLookup onPick={applyCandidate} />}

      <form onSubmit={save}>
        <Card title="Bottle">
          <Field label="Name">
            <input
              required
              value={f.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Eagle Rare 10 Year"
            />
          </Field>

          <div className="grid-2">
            <Field label="Distillery">
              <input
                value={f.distillery ?? ""}
                onChange={(e) => set("distillery", e.target.value)}
              />
            </Field>
            <Field label="Category">
              <select
                value={f.category ?? ""}
                onChange={(e) => set("category", e.target.value || null)}
              >
                <option value="">—</option>
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid-3">
            <Field label="Age (years)">
              <input
                type="number"
                step="0.5"
                value={f.age_years ?? ""}
                onChange={(e) => set("age_years", num(e.target.value))}
              />
            </Field>
            <Field label="ABV %">
              <input
                type="number"
                step="0.1"
                value={f.abv ?? ""}
                onChange={(e) => set("abv", num(e.target.value))}
              />
            </Field>
            <Field label="Bottle size (ml)">
              <input
                type="number"
                value={f.size_ml ?? 750}
                onChange={(e) => set("size_ml", Number(e.target.value))}
              />
            </Field>
          </div>

          <Field
            label="Bottle photo"
            hint="On a phone, this opens the camera. The image is compressed and saved with the bottle."
          >
            <input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={photoBusy}
              onChange={(event) => {
                void addPhoto(event.currentTarget.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
          </Field>

          {f.photo_url && (
            <div className="row-between" style={{ marginTop: 4 }}>
              <img
                src={f.photo_url}
                alt="Bottle preview"
                style={{ height: 72, maxWidth: 104, objectFit: "contain", borderRadius: 8, background: "var(--surface-3)" }}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => set("photo_url", null)}
              >
                Remove photo
              </Button>
            </div>
          )}
        </Card>

        <Card title="Status & fill level">
          <div className="field">
            <label>Status</label>
            <div className="segment">
              {(["sealed", "open", "finished"] as const).map((s) => (
                <button
                  type="button"
                  key={s}
                  className={f.status === s ? "on" : ""}
                  onClick={() => setStatus(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {f.status === "open" && (
            <div className="field" style={{ marginBottom: 0 }}>
              <label>
                Roughly how full? — <strong>{fillPct}%</strong>{" "}
                <span className="faint">(~{f.remaining_ml ?? bottleSize} ml)</span>
              </label>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={fillPct}
                onChange={(e) => setFillPct(Number(e.target.value))}
              />
              <div className="fill-scale">
                <span>empty</span>
                <span>½</span>
                <span>full</span>
              </div>
            </div>
          )}
        </Card>

        <Card title="Flavor profile">
          <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
            Saved with this bottle and used for recommendations. Tags describe flavor only; proof remains the value you entered above.
          </p>
          <div className="grid-3">
            {FLAVOR_TAGS.map((tag) => (
              <Field key={tag} label={FLAVOR_LABELS[tag]}>
                <select
                  value={f.flavor_profile?.[tag] ?? ""}
                  onChange={(event) => setFlavorStrength(tag, event.target.value)}
                >
                  <option value="">Not present</option>
                  <option value="1">Subtle</option>
                  <option value="2">Medium</option>
                  <option value="3">Prominent</option>
                </select>
              </Field>
            ))}
          </div>
          <div className="row-between" style={{ gap: 12, flexWrap: "wrap" }}>
            <span className="faint" style={{ fontSize: 11 }}>
              {f.flavor_source_url ? <a href={f.flavor_source_url} target="_blank" rel="noreferrer">Source: {f.flavor_source ?? "WhiskyCast"} ↗</a> : `Source: ${f.flavor_source ?? "Manual or not set"}`}
            </span>
            <Button type="button" variant="secondary" loading={flavorBusy} disabled={!editing} onClick={lookupFlavorProfile}>
              Look up WhiskyCast tasting notes
            </Button>
          </div>
        </Card>

        <Card title="Purchase & storage">
          <div className="grid-3">
            <Field label="Purchase date">
              <input
                type="date"
                value={f.purchase_date ?? ""}
                onChange={(e) => set("purchase_date", e.target.value || null)}
              />
            </Field>
            <Field label="Purchase price ($)">
              <input
                type="number"
                step="0.01"
                value={f.purchase_price ?? ""}
                onChange={(e) => set("purchase_price", num(e.target.value))}
              />
            </Field>
            <Field label="Location">
              <input
                value={f.location ?? ""}
                onChange={(e) => set("location", e.target.value)}
                placeholder="Shelf 2"
              />
            </Field>
          </div>
          <Field label="Notes">
            <textarea value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </Field>
          {f.source_url && (
            <a href={f.source_url} target="_blank" rel="noreferrer" className="faint" style={{ fontSize: 12 }}>
              Source ↗
            </a>
          )}
        </Card>

        {err && <div className="error-text">{err}</div>}

        <div className="row-between" style={{ marginTop: 16 }}>
          <Button type="button" variant="ghost" onClick={() => nav(-1)}>
            Cancel
          </Button>
          <div className="actions">
            {editing && (
              <Button type="button" variant="danger" onClick={remove}>
                Delete
              </Button>
            )}
            <Button type="submit" variant="primary" loading={saving}>
              Save
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}

/* ---------------- Online lookup panel ---------------- */
function OnlineLookup({ onPick }: { onPick: (c: BottleCandidate) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<BottleCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setBusy(true);
    setErr(null);
    try {
      const { candidates } = await api.lookup(q.trim());
      setResults(candidates);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="lookup-card">
      <div className="card-title" style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <SparkleIcon style={{ width: 16, height: 16, color: "var(--accent)" }} />
        Look up a bottle online
      </div>
      <form onSubmit={search} style={{ display: "flex", gap: 8 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. Lagavulin 16, Blanton's, Redbreast 12"
        />
        <Button variant="primary" loading={busy} type="submit">
          <SearchIcon /> Search
        </Button>
      </form>

      {err && <div className="error-text">{err}</div>}

      {results && results.length === 0 && !busy && (
        <p className="muted" style={{ fontSize: 13, marginBottom: 0, marginTop: 12 }}>
          No matches. Try the brand or a more specific name, or just fill the form in below.
        </p>
      )}

      {results && results.length > 0 && (
        <div className="stack" style={{ marginTop: 12 }}>
          {results.map((c, i) => (
            <div key={i} className="lookup-result" onClick={() => onPick(c)}>
              {c.photo_url ? (
                <img src={c.photo_url} alt="" />
              ) : (
                <div
                  style={{
                    width: 44,
                    height: 56,
                    borderRadius: 6,
                    background: "var(--surface-3)",
                    display: "grid",
                    placeItems: "center",
                    color: "var(--text-faint)",
                    flexShrink: 0,
                  }}
                >
                  <CellarIcon style={{ width: 18, height: 18 }} />
                </div>
              )}
              <div className="body">
                <div className="t">{c.name}</div>
                {c.notes && <div className="d">{c.notes}</div>}
                <div className="tags">
                  {c.category && <span className="tag">{c.category}</span>}
                  {c.age_years && <span className="tag">{c.age_years} yr</span>}
                  {c.abv && <span className="tag">{c.abv}% ABV</span>}
                  <span className="tag">{c.source}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
