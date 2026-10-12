import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";
import type { Taster } from "../shared/types";

interface TasterState {
  /** URL prefix for the tasting site: "" on tasting.*, "/guest" on the admin host */
  base: string;
  ready: boolean;
  taster: Taster | null;
  signupCodeRequired: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (b: {
    username: string;
    password: string;
    display_name?: string;
    code?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<TasterState | null>(null);

export function useTaster(): TasterState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTaster must be used inside <TasterProvider>");
  return ctx;
}

export function TasterProvider({ base = "", children }: { base?: string; children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [taster, setTaster] = useState<Taster | null>(null);
  const [signupCodeRequired, setSignupCodeRequired] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await api.taster.me();
      setTaster(r.taster);
      setSignupCodeRequired(r.signupCodeRequired);
    } catch {
      setTaster(null);
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setReady(true));
  }, [refresh]);

  const login = useCallback(
    async (u: string, p: string) => {
      await api.taster.login(u, p);
      await refresh();
    },
    [refresh],
  );

  const register = useCallback(
    async (b: { username: string; password: string; display_name?: string; code?: string }) => {
      await api.taster.register(b);
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    await api.taster.logout().catch(() => {});
    setTaster(null);
  }, []);

  return (
    <Ctx.Provider
      value={{ base, ready, taster, signupCodeRequired, login, register, logout, refresh }}
    >
      {children}
    </Ctx.Provider>
  );
}
