import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import type { TasterTasting } from "../../../shared/types";
import { useTaster } from "../../taster";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Loading,
  RatingInput,
  useToast,
} from "../../components/ui";
import { GlassIcon } from "../../components/icons";

export default function MyNotes() {
  const { base, ready, taster } = useTaster();
  const toast = useToast();
  const [data, setData] = useState<{
    tastings: TasterTasting[];
    count: number;
    avg_rating: number | null;
  } | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<Partial<TasterTasting>>({});

  async function load() {
    try {
      setData(await api.taster.notes());
    } catch {
      setData({ tastings: [], count: 0, avg_rating: null });
    }
  }
  useEffect(() => {
    if (taster) load();
  }, [taster]);

  if (!ready) return <Loading />;

  if (!taster) {
    return (
      <EmptyState
        icon={<GlassIcon />}
        title="Sign in to see your notes"
        action={
          <Link to={`${base}/account`}>
            <Button variant="primary">Sign in</Button>
          </Link>
        }
      >
        Your ratings and tasting notes are saved to your account.
      </EmptyState>
    );
  }

  async function save(id: number) {
    await api.taster.updateNote(id, {
      rating: draft.rating ?? null,
      nose: draft.nose ?? null,
      palate: draft.palate ?? null,
      finish: draft.finish ?? null,
      notes: draft.notes ?? null,
    });
    setEditing(null);
    toast("Updated");
    load();
  }
  async function remove(id: number) {
    if (!confirm("Delete this tasting note?")) return;
    await api.taster.deleteNote(id);
    toast("Deleted");
    load();
  }

  return (
    <>
      <h1 className="tasting-title">My notes</h1>

      {data && data.count > 0 && (
        <div className="stat-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="stat">
            <b>{data.count}</b>
            <span>Tastings</span>
          </div>
          <div className="stat">
            <b>{data.avg_rating != null ? data.avg_rating.toFixed(1) : "—"}</b>
            <span>Avg rating</span>
          </div>
        </div>
      )}

      {!data ? (
        <Loading />
      ) : data.tastings.length === 0 ? (
        <EmptyState icon={<GlassIcon />} title="No tastings logged yet">
          Request a whiskey. Once the bar approves the pour, you can rate it and save notes here.
        </EmptyState>
      ) : (
        <div className="stack">
          {data.tastings.map((t) =>
            editing === t.id ? (
              <Card key={t.id}>
                <Field label={`${t.bottle_name} — rating`}>
                  <RatingInput
                    value={draft.rating ?? null}
                    onChange={(v) => setDraft((d) => ({ ...d, rating: v }))}
                  />
                </Field>
                <div className="grid-3">
                  {(["nose", "palate", "finish"] as const).map((k) => (
                    <Field key={k} label={k[0].toUpperCase() + k.slice(1)}>
                      <textarea
                        value={(draft[k] as string) ?? ""}
                        onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                      />
                    </Field>
                  ))}
                </div>
                <Field label="Notes">
                  <textarea
                    value={draft.notes ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                  />
                </Field>
                <div className="row-between">
                  <Button variant="ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                  <Button variant="primary" onClick={() => save(t.id)}>
                    Save
                  </Button>
                </div>
              </Card>
            ) : (
              <Card key={t.id}>
                <div className="row-between">
                  <div>
                    <b>{t.bottle_name}</b>
                    <div className="faint" style={{ fontSize: 12 }}>
                      {[t.distillery, t.category].filter(Boolean).join(" · ")} ·{" "}
                      {t.created_at.slice(0, 10)}
                    </div>
                  </div>
                  {t.rating != null && <span className="rating-badge">★ {t.rating}/5</span>}
                </div>
                {(t.nose || t.palate || t.finish || t.notes) && (
                  <div className="faint" style={{ fontSize: 12.5, marginTop: 6 }}>
                    {[
                      t.nose && `Nose: ${t.nose}`,
                      t.palate && `Palate: ${t.palate}`,
                      t.finish && `Finish: ${t.finish}`,
                      t.notes,
                    ]
                      .filter(Boolean)
                      .join("  —  ")}
                  </div>
                )}
                <div className="actions" style={{ marginTop: 10 }}>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(t.id);
                      setDraft(t);
                    }}
                  >
                    Edit
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => remove(t.id)}>
                    Delete
                  </Button>
                </div>
              </Card>
            ),
          )}
        </div>
      )}
    </>
  );
}
