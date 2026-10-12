import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { Button, Card, Field, PageHeader, useToast } from "../components/ui";

export default function Account() {
  const { label, emailTo, emailLogin, logout } = useAuth();
  const toast = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setErr("Passwords don't match");
    setBusy(true);
    setErr(null);
    try {
      await api.setCredentials(username.trim(), password);
      setUsername("");
      setPassword("");
      setConfirm("");
      toast("Backup password saved");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Account" subtitle={`Signed in as ${label ?? "admin"}`} />

      <Card title="How sign-in works">
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          The main way in is a one-time code emailed to{" "}
          <strong>{emailTo || "your admin email"}</strong>
          {emailLogin ? "" : " (not enabled yet — set RESEND_API_KEY)"}. The username + password
          below is a permanent backup so you can never be locked out.
        </p>
      </Card>

      <Card title="Set / replace the backup password">
        <form onSubmit={submit} style={{ maxWidth: 380 }}>
          <Field label="Username">
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </Field>
          <Field label="Password" hint="At least 8 characters.">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Confirm password">
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          {err && <div className="error-text">{err}</div>}
          <Button variant="primary" loading={busy} style={{ marginTop: 6 }}>
            Save backup password
          </Button>
        </form>
      </Card>

      <Card title="Session">
        <div className="row-between">
          <span className="muted" style={{ fontSize: 13 }}>
            Sign out on this device. Sessions last 30 days.
          </span>
          <Button variant="secondary" onClick={logout}>
            Sign out
          </Button>
        </div>
      </Card>
    </>
  );
}
