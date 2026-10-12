import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type RequestRow, type TastingRow } from "../api";
import type { Bottle, TasterSummary, TastingInput } from "../../shared/types";
import { Badge, Button, Card, EmptyState, Loading, PageHeader, useToast } from "../components/ui";
import { BarIcon, CheckIcon, GlassIcon } from "../components/icons";

const POUR_SIZES = [15, 30, 45, 60];

export default function Operator() {
  const [params, setParams] = useSearchParams();
  const [bottles, setBottles] = useState<Bottle[]>([]);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [recent, setRecent] = useState<TastingRow[]>([]);
  const [tasters, setTasters] = useState<TasterSummary[]>([]);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState<TastingInput | null>(null);
  const [tasterChoice, setTasterChoice] = useState("house");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function load() {
    const [b, r, t, people] = await Promise.all([
      api.bottles(),
      api.requests("pending"),
      api.tastings(),
      api.tasterNotes(),
    ]);
    setBottles(b);
    setRequests(r);
    setRecent(t);
    setTasters(people.tasters);
    setReady(true);
  }

  useEffect(() => {
    load().catch((e) => toast((e as Error).message));
  }, []);

  const pourable = useMemo(() => bottles.filter((b) => b.status !== "finished"), [bottles]);

  useEffect(() => {
    if (!ready || draft || !params.get("bottle")) return;
    const bottleId = Number(params.get("bottle"));
    if (pourable.some((b) => b.id === bottleId))
      setDraft({ bottle_id: bottleId, pour_ml: 30, taster_name: null });
    setParams({}, { replace: true });
  }, [ready, draft, params, pourable]);

  function startNew() {
    setTasterChoice("house");
    setDraft({ bottle_id: pourable[0]?.id ?? 0, pour_ml: 30, taster_name: null });
  }

  function startFromRequest(request: RequestRow) {
    setTasterChoice("request");
    setDraft({
      bottle_id: request.bottle_id ?? 0,
      request_id: request.id,
      taster_name: request.requester_name,
      pour_ml: 30,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function chooseTaster(value: string) {
    setTasterChoice(value);
    if (!draft) return;
    const person = value.startsWith("t:") ? tasters.find((t) => t.id === Number(value.slice(2))) : null;
    setDraft({
      ...draft,
      taster_name: person ? (person.display_name ?? person.username) : value === "custom" ? "" : null,
    });
  }

  async function decline(id: number) {
    await api.declineRequest(id);
    toast("Request declined");
    await load();
  }

  async function submit() {
    if (!draft?.bottle_id) return;
    setSaving(true);
    try {
      if (draft.request_id) await api.approveRequest(draft.request_id, draft.pour_ml ?? 30);
      else await api.createTasting(draft);
      setDraft(null);
      toast(draft.request_id ? "Pour approved and logged" : "Pour logged");
      await load();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!ready) return <Loading />;

  return (
    <>
      <PageHeader
        title="Bar"
        subtitle="Approve requests and log pours"
        actions={!draft && (
          <Button variant="primary" onClick={startNew} disabled={pourable.length === 0}>
            <GlassIcon /> New pour
          </Button>
        )}
      />

      {draft && (
        <Card title={draft.request_id ? "Approve requested pour" : "Quick log a pour"}>
          <div className="quick-pour-grid">
            <div className="field">
              <label>Bottle</label>
              <select
                value={draft.bottle_id}
                disabled={Boolean(draft.request_id)}
                onChange={(e) => setDraft({ ...draft, bottle_id: Number(e.target.value) })}
              >
                {pourable.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Pour size</label>
              <div className="segment pour-sizes">
                {POUR_SIZES.map((size) => (
                  <button
                    type="button"
                    key={size}
                    className={draft.pour_ml === size ? "on" : ""}
                    onClick={() => setDraft({ ...draft, pour_ml: size })}
                  >
                    {size} ml
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Taster</label>
              {draft.request_id ? (
                <input value={draft.taster_name ?? ""} disabled />
              ) : (
                <>
                  <select value={tasterChoice} onChange={(e) => chooseTaster(e.target.value)}>
                    <option value="house">House pour</option>
                    {tasters.map((t) => (
                      <option key={t.id} value={"t:" + t.id}>{t.display_name ?? t.username}</option>
                    ))}
                    <option value="custom">Other guest</option>
                  </select>
                  {tasterChoice === "custom" && (
                    <input
                      style={{ marginTop: 8 }}
                      placeholder="Guest name"
                      value={draft.taster_name ?? ""}
                      onChange={(e) => setDraft({ ...draft, taster_name: e.target.value })}
                    />
                  )}
                </>
              )}
            </div>
          </div>

          {draft.request_id ? (
            <p className="muted" style={{ fontSize: 13 }}>
              Approval unlocks this pour for the taster. They can then save one personal note for it.
            </p>
          ) : (
            <details className="pour-details">
              <summary>Add rating and tasting details</summary>
              <div className="grid-2" style={{ marginTop: 14 }}>
                <div className="field">
                  <label>Rating (0–5 stars)</label>
                  <input
                    type="number" step="0.5" min="0" max="5"
                    value={draft.rating ?? ""}
                    onChange={(e) => setDraft({ ...draft, rating: e.target.value === "" ? null : Number(e.target.value) })}
                  />
                </div>
                <div className="field">
                  <label>Overall notes</label>
                  <input value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
                </div>
              </div>
              <div className="grid-3">
                {(["nose", "palate", "finish"] as const).map((key) => (
                  <div className="field" key={key}>
                    <label style={{ textTransform: "capitalize" }}>{key}</label>
                    <textarea value={draft[key] ?? ""} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
                  </div>
                ))}
              </div>
            </details>
          )}

          <div className="row-between" style={{ marginTop: 14 }}>
            <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
            <Button variant="primary" onClick={submit} loading={saving}>
              <CheckIcon /> {draft.request_id ? "Approve & log pour" : "Log pour"}
            </Button>
          </div>
        </Card>
      )}

      <h2 style={{ fontSize: 15, margin: "26px 0 12px" }}>
        Requests {requests.length > 0 && <Badge kind="pending">{requests.length}</Badge>}
      </h2>
      {requests.length === 0 ? (
        <EmptyState icon={<BarIcon />} title="Queue is empty">
          Authenticated taster requests appear here for approval.
        </EmptyState>
      ) : (
        <div className="stack">
          {requests.map((request) => (
            <Card key={request.id}>
              <div className="row-between">
                <div>
                  <b>{request.requester_name}</b>
                  <div className="meta muted" style={{ fontSize: 13 }}>
                    wants {request.bottle_name || "a pour"}
                    {request.note ? " — “" + request.note + "”" : ""}
                  </div>
                </div>
                <div className="actions">
                  <Button size="sm" variant="primary" onClick={() => startFromRequest(request)}>Approve pour</Button>
                  <Button size="sm" variant="danger" onClick={() => decline(request.id)}>Decline</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: 15, margin: "26px 0 12px" }}>Recent pours &amp; notes</h2>
      {recent.length === 0 ? (
        <EmptyState icon={<GlassIcon />} title="Nothing logged yet" />
      ) : (
        <div className="stack">
          {recent.slice(0, 20).map((t) => (
            <Card key={t.id}>
              <div className="row-between">
                <div>
                  <b>{t.bottle_name}</b>
                  <div className="meta muted" style={{ fontSize: 13 }}>
                    {[t.taster_name || "House pour", t.pour_ml + " ml", t.rating != null && t.rating + "/5"].filter(Boolean).join(" · ")}
                  </div>
                  {(t.nose || t.palate || t.finish || t.notes) && (
                    <div className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>
                      {[t.nose && "Nose: " + t.nose, t.palate && "Palate: " + t.palate, t.finish && "Finish: " + t.finish, t.notes].filter(Boolean).join(" — ")}
                    </div>
                  )}
                </div>
                <span className="faint" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                  {t.created_at.slice(0, 16).replace("T", " ")}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
