import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api, setOnUnauthorized, type AuthStatus } from "./api";

interface AuthState {
  ready: boolean;
  configured: boolean; // a backup username/password exists
  emailLogin: boolean; // Resend key is set, so email codes work
  emailTo: string; // masked admin email
  accessWall: boolean; // Cloudflare Access is in front of this host
  authed: boolean;
  label: string | null; // how you're signed in (username or masked email)
  via: AuthStatus["via"];
  requestCode: () => Promise<string>;
  verifyCode: (code: string) => Promise<void>;
  loginPassword: (username: string, password: string) => Promise<void>;
  setupAccount: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

const EMPTY: AuthStatus = {
  configured: false,
  emailLogin: false,
  emailTo: "",
  accessWall: false,
  authed: false,
  label: null,
  via: null,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [s, setS] = useState<AuthStatus>(EMPTY);

  const refresh = useCallback(async () => {
    try {
      setS(await api.authStatus());
    } catch {
      setS(EMPTY);
    }
  }, []);

  useEffect(() => {
    setOnUnauthorized(() => setS((prev) => ({ ...prev, authed: false, label: null })));
    refresh().finally(() => setReady(true));
  }, [refresh]);

  const requestCode = useCallback(async () => {
    const r = await api.requestCode();
    return r.to;
  }, []);

  const verifyCode = useCallback(async (code: string) => {
    await api.verifyCode(code);
    await refresh();
  }, [refresh]);

  const loginPassword = useCallback(async (u: string, p: string) => {
    await api.login(u, p);
    await refresh();
  }, [refresh]);

  const setupAccount = useCallback(async (u: string, p: string) => {
    await api.setup(u, p);
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    // Cloudflare Access holds its own session — send them to its logout too.
    if (s.via === "access") {
      window.location.href = "/cdn-cgi/access/logout";
      return;
    }
    setS((prev) => ({ ...prev, authed: false, label: null }));
  }, [s.via]);

  return (
    <AuthContext.Provider
      value={{
        ready,
        configured: s.configured,
        emailLogin: s.emailLogin,
        emailTo: s.emailTo,
        accessWall: s.accessWall,
        authed: s.authed,
        label: s.label,
        via: s.via,
        requestCode,
        verifyCode,
        loginPassword,
        setupAccount,
        logout,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
