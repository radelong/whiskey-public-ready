import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { api, type Stats } from "../api";
import type { Bottle } from "../../shared/types";
import { bottleLine, money, poursLeft } from "../lib";
import {
  Badge,
  Button,
  EmptyState,
  Loading,
  PageHeader,
  useToast,
} from "../components/ui";
import { CellarIcon, DollarIcon, GlassIcon, PlusIcon } from "../components/icons";

const FILTERS = ["all", "sealed", "open", "finished"] as const;
type Filter = (typeof FILTERS)[number];

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [bottles, setBottles] = useState<Bottle[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [savingBottleIds, setSavingBottleIds] = useState<number[]>([]);
  const [profileProgress, setProfileProgress] = useState<{ done: number; total: number; found: number } | null>(null);
  const stopProfileRun = useRef(false);
  const [profileRunActive, setProfileRunActive] = useState(false);
  const [profileCurrent, setProfileCurrent] = useState("");
  const [profileIssues, setProfileIssues] = useState<string[]>([]);
  const savedVolumes = useRef(new Map<number, number>());
  const toast = useToast();

  async function load() {
    try {
      const [s, b] = await Promise.all([api.stats(), api.bottles()]);
      setStats(s);
      setBottles(b);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
      setBottles([]);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function open(id: number) {
    await api.openBottle(id);
    toast("Bottle opened");
    load();
  }

  async function backfillFlavorProfiles() {
    if (profileRunActive) {
      stopProfileRun.current = true;
      return;
    }
    const missing = (bottles ?? []).filter((bottle) => !bottle.flavor_profile || Object.keys(bottle.flavor_profile).length === 0);
    if (!missing.length) {
      toast("All active bottles already have flavor profiles");
      return;
    }
    stopProfileRun.current = false;
    setProfileRunActive(true);
    setProfileIssues([]);
    setProfileProgress({ done: 0, total: missing.length, found: 0 });
    let found = 0;
    let done = 0;
    try {
      for (const bottle of missing) {
        if (stopProfileRun.current) break;
        setProfileCurrent([bottle.distillery?.trim(), bottle.name].filter(Boolean).join(" — "));
        const result = await api.lookupFlavorProfile(bottle.id, true);
        if (result.found) {
          found++;
          setBottles((current) => current?.map((item) => item.id === bottle.id ? {
            ...item, flavor_profile: result.flavor_profile, flavor_source: result.flavor_source,
            flavor_source_url: result.flavor_source_url,
          } : item) ?? null);
        } else if (!result.skipped) {
          const unavailable = ["search-unavailable", "review-unavailable", "lookup-failed"].includes(result.reason ?? "");
          setProfileIssues((current) => [...current, `${bottle.distillery ?? ""} ${bottle.name}: ${unavailable ? "Source unavailable; can retry" : "No matching tasting note found"}`]);
        }
        done++;
        setProfileProgress({ done, total: missing.length, found });
        // Keep source lookups sequential and modest in rate. Successful bottle
        // updates persist independently, so stopping or retrying is safe.
        await new Promise((resolve) => window.setTimeout(resolve, 1_500));
      }
      await load();
      toast(stopProfileRun.current ? `Stopped after ${done}; saved ${found} profiles. Start again to resume.` : `Profile lookup complete: saved ${found} of ${done} profiles.`);
    } catch (e) {
      await load();
      toast(`Stopped after ${done}; saved ${found} profiles. ${((e as Error).message)} You can resume safely.`);
    } finally {
      setProfileRunActive(false);
      setProfileCurrent("");
    }
  }

  function showVolume(id: number, remaining_ml: number) {
    setBottles((current) =>
      current?.map((bottle) =>
        bottle.id === id ? { ...bottle, remaining_ml } : bottle,
      ) ?? null,
    );
  }

  async function saveVolume(bottle: Bottle, remaining_ml: number) {
    const next = Math.max(0, Math.min(bottle.size_ml, remaining_ml));
    if (savedVolumes.current.get(bottle.id) === next) return;
    savedVolumes.current.set(bottle.id, next);
    setSavingBottleIds((ids) => (ids.includes(bottle.id) ? ids : [...ids, bottle.id]));

    try {
      const [updated, nextStats] = await Promise.all([
        api.updateBottle(bottle.id, {
          remaining_ml: next,
          status: next === 0 ? "finished" : "open",
        }, bottle.version),
        api.stats(),
      ]);
      setBottles((current) =>
        current?.map((item) => (item.id === updated.id ? updated : item)) ?? null,
      );
      setStats(nextStats);
      toast(next === 0 ? "Bottle marked finished" : "Amount left updated");
    } catch (e) {
      savedVolumes.current.delete(bottle.id);
      showVolume(bottle.id, bottle.remaining_ml ?? bottle.size_ml);
      toast((e as Error).message);
    } finally {
      setSavingBottleIds((ids) => ids.filter((id) => id !== bottle.id));
    }
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (bottles ?? []).filter((b) => {
      if (filter !== "all" && b.status !== filter) return false;
      if (!q) return true;
      return [b.name, b.distillery, b.category].some((v) => v?.toLowerCase().includes(q));
    });
  }, [bottles, filter, query]);

  return (
    <>
      <PageHeader
        title="Cellar"
        subtitle="Your whiskey inventory"
        actions={
          <>
            <Link to="/import">
              <Button variant="secondary">Import</Button>
            </Link>
            <Button variant="secondary" onClick={backfillFlavorProfiles} disabled={!bottles}>
              {profileRunActive ? "Stop profile lookup" : "Look up flavor profiles"}
            </Button>
            <Link to="/bottle/new">
              <Button variant="primary">
                <PlusIcon /> Add bottle
              </Button>
            </Link>
          </>
        }
      />

      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <strong>Tasting notes: {(bottles ?? []).filter((bottle) => bottle.flavor_profile && Object.keys(bottle.flavor_profile).length).length} of {bottles?.length ?? 0} bottles ready</strong>
        {profileProgress && <div role="status" style={{ marginTop: 6 }}>
          {profileRunActive ? "Looking up notes" : "Lookup stopped or finished"}: {profileProgress.done}/{profileProgress.total} checked · {profileProgress.found} saved
          {profileRunActive && <p className="muted" style={{ margin: "6px 0 0" }}>Checking {profileCurrent || "the next bottle"}. Keep this page open until finished; this may take several minutes. Matches save automatically.</p>}
        </div>}
        {profileIssues.length > 0 && <details style={{ marginTop: 8 }}>
          <summary>{profileIssues.length} bottles still need a note</summary>
          <ul>{profileIssues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>
        </details>}
      </div>

      {stats && (
        <div className="stat-row cellar-stats">
          <div className="stat">
            <div className="stat-icon">
              <CellarIcon />
            </div>
            <b>{stats.total_bottles}</b>
            <span>Bottles</span>
          </div>
          <div className="stat">
            <div className="stat-icon">
              <GlassIcon />
            </div>
            <b>{stats.open}</b>
            <span>Open now</span>
          </div>
          <div className="stat">
            <div className="stat-icon">
              <CellarIcon />
            </div>
            <b>{stats.sealed}</b>
            <span>Sealed</span>
          </div>
          <div className="stat">
            <div className="stat-icon">
              <DollarIcon />
            </div>
            <b>{money(stats.total_spent)}</b>
            <span>Invested</span>
          </div>
        </div>
      )}

      <div className="row-between cellar-tools" style={{ marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div className="segment">
          {FILTERS.map((f) => (
            <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
              {f}
            </button>
          ))}
        </div>
        <input
          placeholder="Search name, distillery…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 240 }}
        />
      </div>

      {err && <div className="error-text">{err}</div>}

      {bottles === null ? (
        <Loading />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<CellarIcon />}
          title={bottles.length === 0 ? "No bottles yet" : "Nothing matches"}
          action={
            bottles.length === 0 ? (
              <Link to="/bottle/new">
                <Button variant="primary">
                  <PlusIcon /> Add your first bottle
                </Button>
              </Link>
            ) : undefined
          }
        >
          {bottles.length === 0
            ? "Add a bottle by hand or look one up online."
            : "Try a different search or filter."}
        </EmptyState>
      ) : (
        <div className="bottle-list">
          {shown.map((b) => (
            <div className="bottle-row" key={b.id}>
              <div
                className="bottle-thumb"
              >
                {b.photo_url ? <img src={b.photo_url} alt={b.name} loading="lazy" /> : <CellarIcon />}
              </div>
              <div className="bottle-main">
                <div className="row-between">
                  <Link to={`/bottle/${b.id}`} className="name" style={{ color: "inherit" }}>
                    {b.name}
                  </Link>
                  <Badge kind={b.status}>{b.status}</Badge>
                </div>
                <div className="meta">{bottleLine(b) || "—"}</div>
                <div className="sub">
                  {money(b.purchase_price)}
                  {b.purchase_date ? ` · bought ${b.purchase_date}` : ""}
                  {b.rating_count ? (
                    <span className="rating-badge" style={{ marginLeft: 8 }}>
                      ★ {b.avg_rating!.toFixed(1)} ({b.rating_count})
                    </span>
                  ) : null}
                </div>
                {b.status === "open" && (
                  <VolumeControl
                    bottle={b}
                    saving={savingBottleIds.includes(b.id)}
                    onChange={(value) => showVolume(b.id, value)}
                    onCommit={(value) => saveVolume(b, value)}
                  />
                )}
              </div>
              {b.status === "sealed" && (
                <Button size="sm" variant="secondary" onClick={() => open(b.id)}>
                  Open
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function VolumeControl({
  bottle,
  saving,
  onChange,
  onCommit,
}: {
  bottle: Bottle;
  saving: boolean;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const remaining = Math.max(0, Math.min(bottle.size_ml, bottle.remaining_ml ?? bottle.size_ml));
  const percent = Math.round((remaining / bottle.size_ml) * 100);
  const id = `volume-${bottle.id}`;

  return (
    <div className="cellar-volume-control">
      <label htmlFor={id}>
        <span>Amount left</span>
        <strong>{remaining} mL · {percent}%</strong>
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={bottle.size_ml}
        step={15}
        value={remaining}
        style={{ "--fill-percent": `${percent}%` } as CSSProperties}
        disabled={saving}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        onPointerUp={(event) => onCommit(Number(event.currentTarget.value))}
        onBlur={(event) => onCommit(Number(event.currentTarget.value))}
        aria-label={`Amount left in ${bottle.name}`}
      />
      <div className="fill-scale">
        <span>empty</span>
        <span>½</span>
        <span>{saving ? "saving…" : poursLeft(remaining, bottle.size_ml)}</span>
      </div>
    </div>
  );
}
