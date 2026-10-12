import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Button, Field } from "../components/ui";
import { CellarIcon, GuestIcon } from "../components/icons";

export default function Login() {
  const { authed, configured, emailLogin, emailTo, requestCode, verifyCode, loginPassword } =
    useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const dest = loc.state?.from || "/";

  const [step, setStep] = useState<"choose" | "code">("choose");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "code" | "verify" | "password">(null);

  if (authed) return <Navigate to={dest} replace />;

  async function sendCode() {
    setBusy("code");
    setErr(null);
    try {
      const to = await requestCode();
      setSentTo(to);
      setStep("code");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function checkCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy("verify");
    setErr(null);
    try {
      await verifyCode(code.trim());
      nav(dest, { replace: true });
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  }

  async function signInPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy("password");
    setErr(null);
    try {
      await loginPassword(username.trim(), password);
      nav(dest, { replace: true });
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand">
          <span className="mark">
            <CellarIcon />
          </span>
          <span>
            Whiskey Cellar
            <small>Staff sign in</small>
          </span>
        </div>

        {step === "code" ? (
          <form onSubmit={checkCode}>
            <h1>Enter your code</h1>
            <p>
              We emailed a 6-digit code to <strong>{sentTo}</strong>. It expires in 10 minutes.
            </p>
            <Field label="6-digit code">
              <input
                autoFocus
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                style={{ letterSpacing: "0.4em", fontSize: 18, textAlign: "center" }}
              />
            </Field>
            {err && <div className="error-text">{err}</div>}
            <Button
              variant="primary"
              block
              loading={busy === "verify"}
              disabled={code.length !== 6}
              style={{ marginTop: 8 }}
            >
              Verify &amp; sign in
            </Button>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
              <button type="button" className="linklike" onClick={() => setStep("choose")}>
                ← Back
              </button>
              <button type="button" className="linklike" onClick={sendCode} disabled={busy === "code"}>
                {busy === "code" ? "Sending…" : "Resend code"}
              </button>
            </div>
          </form>
        ) : (
          <>
            <h1>Sign in</h1>

            {emailLogin ? (
              <>
                <p>Get a one-time code by email — no password to remember.</p>
                <Button variant="primary" block loading={busy === "code"} onClick={sendCode}>
                  Email me a code
                </Button>
                <p className="faint" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
                  Sent to {emailTo}
                </p>
              </>
            ) : (
              <p>Managing the collection needs an account.</p>
            )}

            {configured && (
              <>
                {emailLogin && (
                  <div className="or-divider">
                    <span>or use a password</span>
                  </div>
                )}
                <form onSubmit={signInPassword}>
                  <Field label="Username">
                    <input
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoComplete="username"
                    />
                  </Field>
                  <Field label="Password">
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                    />
                  </Field>
                  <Button variant={emailLogin ? "secondary" : "primary"} block loading={busy === "password"}>
                    Sign in with password
                  </Button>
                </form>
              </>
            )}

            {!configured && !emailLogin && (
              <Link to="/setup">
                <Button variant="primary" block style={{ marginTop: 6 }}>
                  Set up the admin account
                </Button>
              </Link>
            )}

            {err && <div className="error-text">{err}</div>}
          </>
        )}
      </div>

      <Link to="/guest" className="guest-cta">
        <GuestIcon />
        <span>
          Here as a guest? <strong>Request a pour</strong> — no sign in needed
        </span>
      </Link>
    </div>
  );
}
