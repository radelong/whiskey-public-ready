import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../api";
import type { TasterTasting, TastingRequest, WhiskeyDetail as Detail } from "../../../shared/types";
import { proof } from "../../lib";
import { useTaster } from "../../taster";
import { Badge, Button, Card, Field, Loading, RatingBadge, RatingInput, useToast } from "../../components/ui";
import { CellarIcon } from "../../components/icons";
import { flavorSummary } from "../../../shared/flavors";

type NoteDraft = {
  rating: number | null;
  nose: string;
  palate: string;
  finish: string;
  notes: string;
};
const EMPTY_NOTE: NoteDraft = { rating: null, nose: "", palate: "", finish: "", notes: "" };

export default function WhiskeyDetail() {
  const { id } = useParams();
  const bottleId = Number(id);
  const { base, taster } = useTaster();
  const toast = useToast();
  const [whiskey, setWhiskey] = useState<Detail | null>(null);
  const [requests, setRequests] = useState<TastingRequest[]>([]);
  const [myNotes, setMyNotes] = useState<TasterTasting[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState<NoteDraft>(EMPTY_NOTE);
  const [requestNote, setRequestNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadWhiskey() {
    setWhiskey(await api.whiskey(bottleId));
  }

  async function loadAccountData() {
    if (!taster) {
      setRequests([]);
      setMyNotes([]);
      return;
    }
    const [requestRows, noteRows] = await Promise.all([api.taster.requests(bottleId), api.taster.notes()]);
    const notes = noteRows.tastings.filter((note) => note.bottle_id === bottleId);
    setRequests(requestRows);
    setMyNotes(notes);
    const approved = requestRows.filter((request) => request.status === "poured" && request.approved_at && !request.cancelled_at);
    const next = approved.find((request) => !request.tasting_id) ?? approved[0];
    setSelected((current) => current && approved.some((request) => request.id === current) ? current : (next?.id ?? null));
  }

  useEffect(() => {
    Promise.all([loadWhiskey(), loadAccountData()]).catch((e) => setError((e as Error).message));
  }, [id, taster]);

  const approved = useMemo(
    () => requests.filter((request) => request.status === "poured" && request.approved_at && !request.cancelled_at),
    [requests],
  );
  const selectedRequest = approved.find((request) => request.id === selected) ?? null;
  const existingNote = myNotes.find((note) => note.request_id === selected) ?? null;
  const hasUnusedApproval = approved.some((request) => !request.tasting_id);
  const pending = requests.some((request) => request.status === "pending" && !request.cancelled_at);

  useEffect(() => {
    setDraft(existingNote ? {
      rating: existingNote.rating,
      nose: existingNote.nose ?? "",
      palate: existingNote.palate ?? "",
      finish: existingNote.finish ?? "",
      notes: existingNote.notes ?? "",
    } : EMPTY_NOTE);
  }, [selected, existingNote?.id]);

  async function saveNote(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedRequest) return;
    if (draft.rating == null && !draft.nose && !draft.palate && !draft.finish && !draft.notes) {
      toast("Add a rating or tasting note first");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        bottle_id: bottleId,
        request_id: selectedRequest.id,
        rating: draft.rating,
        nose: draft.nose || null,
        palate: draft.palate || null,
        finish: draft.finish || null,
        notes: draft.notes || null,
      };
      if (existingNote) await api.taster.updateNote(existingNote.id, payload);
      else await api.taster.addNote(payload);
      toast(existingNote ? "Tasting updated" : "Tasting saved to your profile");
      await Promise.all([loadWhiskey(), loadAccountData()]);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function requestPour() {
    try {
      await api.createRequest({ bottle_id: bottleId, requester_name: "", note: requestNote.trim() || null });
      setRequestNote("");
      toast("Pour requested");
      await loadAccountData();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  async function cancelRequest(requestId: number) {
    try {
      await api.taster.cancelRequest(requestId);
      toast("Request cancelled");
      await loadAccountData();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  if (error) return <div className="error-text">{error}</div>;
  if (!whiskey) return <Loading />;

  return (
    <>
      <Link to={base || "/"} className="faint" style={{ fontSize: 12.5 }}>← All whiskeys</Link>
      <div className="whiskey-hero">
        <div className="bottle-thumb" style={{ width: 64, height: 64 }}>
          {whiskey.photo_url ? <img src={whiskey.photo_url} alt={whiskey.name} /> : <CellarIcon />}
        </div>
        <div>
          <h1 className="tasting-title" style={{ margin: 0 }}>
            <a
              href={`/api/whiskybase/${whiskey.id}`}
              target="_blank"
              rel="noreferrer"
              className="whiskeybase-title-link"
              title={`Open ${whiskey.name} on Whiskybase`}
            >
              {whiskey.name} ↗
            </a>
          </h1>
          <div className="muted" style={{ fontSize: 13 }}>
            {[whiskey.distillery, whiskey.category, whiskey.age_years && whiskey.age_years + " yr", proof(whiskey.abv)].filter(Boolean).join(" · ")}
          </div>
          <div style={{ marginTop: 5 }}><RatingBadge value={whiskey.avg_rating} count={whiskey.rating_count} /></div>
        </div>
      </div>

      {flavorSummary(whiskey.flavor_profile) && (
        <Card title="Internet tasting note">
          <p style={{ margin: 0, fontSize: 13 }}>{flavorSummary(whiskey.flavor_profile, whiskey.flavor_source)}</p>
          {whiskey.flavor_source_url && (
            <a href={whiskey.flavor_source_url} target="_blank" rel="noreferrer" className="faint" style={{ display: "inline-block", marginTop: 8, fontSize: 11 }}>
              Flavor reference: {whiskey.flavor_source ?? "source"} ↗
            </a>
          )}
        </Card>
      )}

      {taster ? (
        <>
          {requests.length > 0 && (
            <Card title="Your pour requests">
              <div className="stack">
                {requests.map((request) => {
                  const status = request.cancelled_at ? "cancelled" : request.status === "poured" ? "approved" : request.status === "declined" ? "rejected" : "pending";
                  return (
                    <div className="request-status-row" key={request.id}>
                      <div>
                        <Badge kind={request.status === "poured" ? "open" : request.status}>{status}</Badge>
                        <span className="faint" style={{ fontSize: 12, marginLeft: 8 }}>
                          {request.pour_ml ? request.pour_ml + " ml · " : ""}{request.created_at.slice(0, 10)}
                          {request.tasting_id ? " · tasting saved" : ""}
                        </span>
                      </div>
                      {request.status === "pending" && !request.cancelled_at && (
                        <Button size="sm" variant="ghost" onClick={() => cancelRequest(request.id)}>Cancel</Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {approved.length > 0 && (
            <Card title={existingNote ? "Edit your tasting" : "Log your tasting"}>
              {approved.length > 1 && (
                <Field label="Approved pour">
                  <select value={selected ?? ""} onChange={(e) => setSelected(Number(e.target.value))}>
                    {approved.map((request) => (
                      <option key={request.id} value={request.id}>
                        {request.pour_ml} ml approved {request.approved_at?.slice(0, 10)}
                        {request.tasting_id ? " — note saved" : " — ready for notes"}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
                Notes are attached to this {selectedRequest?.pour_ml} ml approved pour.
              </p>
              <form onSubmit={saveNote}>
                <Field label="Your rating"><RatingInput value={draft.rating} onChange={(rating) => setDraft({ ...draft, rating })} /></Field>
                <div className="grid-3">
                  {(["nose", "palate", "finish"] as const).map((key) => (
                    <Field key={key} label={key[0].toUpperCase() + key.slice(1)}>
                      <textarea value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
                    </Field>
                  ))}
                </div>
                <Field label="Overall notes"><textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field>
                <Button variant="primary" loading={saving}>{existingNote ? "Update my tasting" : "Save to my profile"}</Button>
              </form>
            </Card>
          )}

          {!hasUnusedApproval && whiskey.status !== "finished" && (
            <Card title={pending ? "Pour requested" : approved.length ? "Request another pour" : "Request a pour"}>
              {pending ? (
                <p className="muted" style={{ fontSize: 13, margin: 0 }}>Waiting for the bar to approve your request. Notes unlock after approval.</p>
              ) : (
                <>
                  <Field label="Note for the bar (optional)">
                    <input value={requestNote} onChange={(e) => setRequestNote(e.target.value)} placeholder="Neat, please" />
                  </Field>
                  <Button variant="secondary" onClick={requestPour}>Ask for a pour</Button>
                </>
              )}
            </Card>
          )}
        </>
      ) : (
        <Card>
          <p className="muted" style={{ fontSize: 13, margin: "0 0 12px" }}>
            Sign in to request a pour and save tasting notes to your profile.
          </p>
          <Link to={base + "/account"}><Button variant="primary">Sign in / create account</Button></Link>
        </Card>
      )}

      <h2 style={{ fontSize: 15, margin: "24px 0 12px" }}>
        Tasting notes {whiskey.notes.length > 0 && <span className="faint">({whiskey.notes.length})</span>}
      </h2>
      {whiskey.notes.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>No notes yet.</p>
      ) : (
        <div className="stack">
          {whiskey.notes.map((note) => (
            <Card key={note.id}>
              <div className="row-between">
                <b>Community tasting note</b>
                {note.rating != null && <span className="rating-badge">★ {note.rating}/5</span>}
              </div>
              {(note.nose || note.palate || note.finish || note.notes) && (
                <div className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>
                  {[note.nose && "Nose: " + note.nose, note.palate && "Palate: " + note.palate, note.finish && "Finish: " + note.finish, note.notes].filter(Boolean).join(" — ")}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
