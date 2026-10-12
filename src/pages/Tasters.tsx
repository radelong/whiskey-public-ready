import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { AdminTasterNote, TasterSummary } from "../../shared/types";
import { Button, Card, EmptyState, Loading, PageHeader, useToast } from "../components/ui";
import { UserIcon } from "../components/icons";

type Sort = "taster" | "whiskey" | "recent";

export default function Tasters() {
  const toast = useToast();
  const [data, setData] = useState<{ tasters: TasterSummary[]; notes: AdminTasterNote[] } | null>(null);
  const [sort, setSort] = useState<Sort>("taster");
  const [query, setQuery] = useState("");
  const [resetPerson, setResetPerson] = useState<TasterSummary | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState("");

  async function resetPassword(event: React.FormEvent) {
    event.preventDefault();
    if (!resetPerson) return;
    if (newPassword !== confirmPassword) { setResetError("Passwords do not match"); return; }
    setResetBusy(true);
    setResetError("");
    try {
      await api.resetTasterPassword(resetPerson.id, newPassword);
      toast("Password reset. Share the new password privately with the taster.");
      setResetPerson(null);
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) { setResetError((error as Error).message); }
    finally { setResetBusy(false); }
  }

  async function load() {
    try { setData(await api.tasterNotes()); }
    catch { setData({ tasters: [], notes: [] }); }
  }
  useEffect(() => { load(); }, []);

  const view = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchingNotes = (data?.notes ?? []).filter((note) =>
      !q || [note.taster, note.bottle_name, note.distillery].some((value) => value?.toLowerCase().includes(q)),
    );
    const people = (data?.tasters ?? []).filter((person) => {
      if (!q) return true;
      const name = (person.display_name ?? person.username).toLowerCase();
      return name.includes(q) || matchingNotes.some((note) => note.taster_id === person.id);
    });
    let notes = matchingNotes.filter((note) => people.some((person) => person.id === note.taster_id));
    if (sort === "whiskey")
      notes = [...notes].sort((a, b) => a.bottle_name.localeCompare(b.bottle_name) || b.created_at.localeCompare(a.created_at));
    else if (sort === "recent") notes = [...notes].sort((a, b) => b.created_at.localeCompare(a.created_at));
    else notes = [...notes].sort((a, b) => a.taster.localeCompare(b.taster) || b.created_at.localeCompare(a.created_at));
    return { people, notes };
  }, [data, query, sort]);

  async function remove(id: number) {
    if (!confirm("Delete this tasting note?")) return;
    await api.deleteTasting(id);
    toast("Deleted");
    load();
  }

  if (!data) return <Loading />;

  const noteCard = (note: AdminTasterNote, showTaster: boolean) => (
    <Card key={note.id}>
      <div className="row-between">
        <div>
          <b>{note.bottle_name}</b>
          <div className="faint" style={{ fontSize: 12 }}>
            {[showTaster && note.taster, note.category, note.created_at.slice(0, 10)].filter(Boolean).join(" · ")}
          </div>
        </div>
        {note.rating != null && <span className="rating-badge">★ {note.rating}/5</span>}
      </div>
      {(note.nose || note.palate || note.finish || note.notes) && (
        <div className="faint" style={{ fontSize: 12.5, marginTop: 6 }}>
          {[note.nose && "Nose: " + note.nose, note.palate && "Palate: " + note.palate, note.finish && "Finish: " + note.finish, note.notes].filter(Boolean).join(" — ")}
        </div>
      )}
      <div className="right" style={{ marginTop: 8 }}><Button size="sm" variant="ghost" onClick={() => remove(note.id)}>Delete</Button></div>
    </Card>
  );

  return (
    <>
      <PageHeader title="Tasters" subtitle={data.tasters.length + " people · " + data.notes.length + " notes"} />
      <div className="row-between" style={{ marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
        <div className="segment">
          <button className={sort === "taster" ? "on" : ""} onClick={() => setSort("taster")}>By taster</button>
          <button className={sort === "whiskey" ? "on" : ""} onClick={() => setSort("whiskey")}>By whiskey</button>
          <button className={sort === "recent" ? "on" : ""} onClick={() => setSort("recent")}>Recent</button>
        </div>
        <input placeholder="Search people or notes…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ maxWidth: 240 }} />
      </div>

      {resetPerson && (
        <Card title={"Reset password for @" + resetPerson.username}>
          <p className="muted">Their notes and ratings will stay saved. Existing sessions will be signed out. Share the new password privately; they can change it in their Account page.</p>
          <form onSubmit={resetPassword}>
            <label className="field" style={{ display: "block" }}>New password
              <input type="password" autoComplete="new-password" minLength={8} maxLength={256} required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </label>
            <label className="field" style={{ display: "block" }}>Confirm new password
              <input type="password" autoComplete="new-password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </label>
            {resetError && <p className="error-text" role="alert">{resetError}</p>}
            <div className="actions">
              <Button type="submit" variant="primary" loading={resetBusy}>Reset password</Button>
              <Button type="button" disabled={resetBusy} onClick={() => { setResetPerson(null); setNewPassword(""); setConfirmPassword(""); }}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      <Card title="Registered tasters">
        {view.people.length === 0 ? (
          <EmptyState
            icon={<UserIcon />}
            title={data.tasters.length ? "No people match" : "No taster accounts yet"}
            action={!data.tasters.length ? <Link to="/share"><Button variant="secondary">Open sharing options</Button></Link> : undefined}
          >
            {data.tasters.length ? "Try a different search." : "Tasters appear here as soon as they create an account."}
          </EmptyState>
        ) : (
          <div className="people-list">
            {view.people.map((person) => (
              <div className="person-row" key={person.id}>
                <span className="avatar">{(person.display_name ?? person.username)[0]}</span>
                <div>
                  <b>{person.display_name ?? person.username}</b>
                  <div className="faint">@{person.username}</div>
                  <Button size="sm" variant="ghost" onClick={() => {
                    setResetPerson(person); setNewPassword(""); setConfirmPassword(""); setResetError("");
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}>Reset password</Button>
                  <div className="faint" style={{ fontSize: 12 }}>
                    {person.note_count === 0 ? "No tasting notes yet" : person.note_count + " notes" + (person.avg_rating != null ? " · avg ★ " + person.avg_rating.toFixed(1) : "")}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <h2 style={{ fontSize: 15, margin: "26px 0 12px" }}>Tasting note analytics</h2>
      {sort === "taster" ? (
        <div className="stack" style={{ gap: 20 }}>
          {view.people.map((person) => {
            const notes = view.notes.filter((note) => note.taster_id === person.id);
            return (
              <div key={person.id}>
                <div className="row-between" style={{ marginBottom: 8 }}>
                  <b>{person.display_name ?? person.username}</b>
                  <span className="faint" style={{ fontSize: 12 }}>{notes.length ? notes.length + " matching note" + (notes.length === 1 ? "" : "s") : "No tasting notes yet"}</span>
                </div>
                {notes.length ? <div className="stack">{notes.map((note) => noteCard(note, false))}</div> : <Card><span className="faint" style={{ fontSize: 13 }}>This taster has not logged a note yet.</span></Card>}
              </div>
            );
          })}
        </div>
      ) : view.notes.length ? (
        <div className="stack">{view.notes.map((note) => noteCard(note, true))}</div>
      ) : (
        <EmptyState icon={<UserIcon />} title="No tasting notes match">Registered tasters remain visible above, including people with zero notes.</EmptyState>
      )}
    </>
  );
}
