import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Button, Field } from "../components/ui";
import { CellarIcon } from "../components/icons";

export default function Setup() {
  const { setupAccount } = useAuth();
  const nav = useNavigate();
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
      await setupAccount(username.trim(), password);
      nav("/", { replace: true });
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand">
          <span className="mark">
            <CellarIcon />
          </span>
          <span>
            Whiskey Cellar
            <small>First-time setup</small>
          </span>
        </div>
        <h1>Create your admin account</h1>
        <p>This is unique to this deployment. You'll use it to manage the collection.</p>

        <Field label="Username" hint="Letters, numbers, dot, dash, underscore.">
          <input
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
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

        <Button variant="primary" block loading={busy} style={{ marginTop: 8 }}>
          Create account
        </Button>
      </form>
    </div>
  );
}
