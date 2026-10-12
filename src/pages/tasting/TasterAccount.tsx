import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api";
import { useTaster } from "../../taster";
import { Button, Card, Field, useToast } from "../../components/ui";

export default function TasterAccount() {
  const { base, ready, taster, signupCodeRequired, login, register, logout } = useTaster();
  const nav = useNavigate();
  const toast = useToast();

  const [mode, setMode] = useState<"login" | "register">("register");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // profile edit
  const [newName, setNewName] = useState("");
  const [newPass, setNewPass] = useState("");

  if (!ready) return null;

  if (taster) {
    return (
      <>
        <h1 className="tasting-title">Account</h1>
        <Card>
          <div className="row-between">
            <div>
              <b>{taster.display_name ?? taster.username}</b>
              <div className="faint" style={{ fontSize: 12 }}>@{taster.username}</div>
            </div>
            <Button variant="secondary" onClick={logout}>
              Sign out
            </Button>
          </div>
        </Card>

        <Card title="Edit profile">
          <Field label="Display name">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={taster.display_name ?? taster.username}
            />
          </Field>
          <Field label="New password" hint="Leave blank to keep your current one.">
            <input
              type="password"
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Button
            variant="primary"
            onClick={async () => {
              try {
                await api.taster.updateAccount({
                  display_name: newName.trim() || undefined,
                  password: newPass || undefined,
                });
                setNewName("");
                setNewPass("");
                toast("Saved");
                location.reload();
              } catch (e) {
                toast((e as Error).message);
              }
            }}
          >
            Save
          </Button>
        </Card>
      </>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (mode === "login") await login(username.trim(), password);
      else
        await register({
          username: username.trim(),
          password,
          display_name: displayName.trim() || undefined,
          code: code.trim() || undefined,
        });
      nav(`${base}/notes`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="tasting-title">{mode === "login" ? "Sign in" : "Create an account"}</h1>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Keeps your ratings and tasting notes so you can find them later.
      </p>

      <form onSubmit={submit}>
        <Card>
          <Field label="Username">
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </Field>
          {mode === "register" && (
            <Field label="Display name" hint="Shown on your notes. Optional.">
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </Field>
          )}
          <Field label="Password" hint={mode === "register" ? "At least 8 characters." : undefined}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
            />
          </Field>
          {mode === "register" && signupCodeRequired && (
            <Field label="Sign-up code" hint="Ask the host.">
              <input value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
          )}
          {err && <div className="error-text">{err}</div>}
          <Button variant="primary" block loading={busy} style={{ marginTop: 6 }}>
            {mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </Card>
      </form>

      {mode === "login" && <p className="muted">Forgot your password? Ask the host to reset your taster password. Your saved ratings and notes will stay on your account.</p>}
      <button
        type="button"
        className="linklike"
        onClick={() => {
          setMode(mode === "login" ? "register" : "login");
          setErr(null);
        }}
      >
        {mode === "login" ? "Need an account? Create one" : "Already have an account? Sign in"}
      </button>
    </>
  );
}
