import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth";
import { TasterProvider } from "./taster";
import { Loading } from "./components/ui";
import { BarIcon, CellarIcon, GuestIcon, LogoutIcon, UserIcon, UsersIcon } from "./components/icons";
import Dashboard from "./pages/Dashboard";
import BottleForm from "./pages/BottleForm";
import BottleDetail from "./pages/BottleDetail";
import Operator from "./pages/Operator";
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import Account from "./pages/Account";
import Share from "./pages/Share";
import Import from "./pages/Import";
import Tasters from "./pages/Tasters";
import TastingApp from "./pages/tasting/TastingApp";

const APP_NAME = "Whiskey Cellar";

/** Hosts that should only ever show the guest request page. */
const GUEST_HOSTS = ["tasting."];
const isGuestHost = () =>
  typeof window !== "undefined" &&
  GUEST_HOSTS.some((h) => window.location.hostname.startsWith(h));

export default function App() {
  const { ready } = useAuth();

  if (!ready) {
    return (
      <div className="auth-wrap">
        <Loading />
      </div>
    );
  }

  // tasting.example.invalid — the guest tasting site, its own little app.
  if (isGuestHost()) {
    return (
      <TasterProvider base="">
        <Routes>
          <Route path="/*" element={<TastingApp />} />
        </Routes>
      </TasterProvider>
    );
  }

  return (
    <Routes>
      <Route
        path="/guest/*"
        element={
          <TasterProvider base="/guest">
            <TastingApp />
          </TasterProvider>
        }
      />
      <Route path="/setup" element={<Setup />} />
      <Route path="/login" element={<Login />} />
      <Route path="/*" element={<AdminShell />} />
    </Routes>
  );
}

/* ---------------- Admin app (login required) ---------------- */
function AdminShell() {
  const { authed, label, logout } = useAuth();
  const loc = useLocation();

  if (!authed) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;

  const nav = (
    <>
      <NavLink to="/" end className="nav-link">
        <CellarIcon /> Cellar
      </NavLink>
      <NavLink to="/bar" className="nav-link">
        <BarIcon /> Bar
      </NavLink>
      <NavLink to="/tasters" className="nav-link">
        <UsersIcon /> Tasters
      </NavLink>
      <NavLink to="/share" className="nav-link">
        <GuestIcon /> Share
      </NavLink>
      <NavLink to="/account" className="nav-link">
        <UserIcon /> Account
      </NavLink>
    </>
  );

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="mark">
            <CellarIcon />
          </span>
          <span>
            {APP_NAME}
            <small>Collection manager</small>
          </span>
        </div>
        {nav}
        <div className="spacer" />
        <div className="account">
          <span className="avatar">{label?.[0]?.toUpperCase() ?? "?"}</span>
          <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
            <div
              style={{
                fontWeight: 600,
                textOverflow: "ellipsis",
                overflow: "hidden",
                whiteSpace: "nowrap",
              }}
            >
              {label}
            </div>
            <div className="faint" style={{ fontSize: 11 }}>
              Admin
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" title="Sign out" onClick={logout}>
            <LogoutIcon />
          </button>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div className="brand" style={{ padding: 0, fontSize: 15 }}>
            <span className="mark" style={{ width: 26, height: 26 }}>
              <CellarIcon />
            </span>
            {APP_NAME}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={logout}>
            <LogoutIcon />
          </button>
        </div>

        <div className="content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/bottle/new" element={<BottleForm />} />
            <Route path="/bottle/:id" element={<BottleDetail />} />
            <Route path="/bottle/:id/edit" element={<BottleForm />} />
            <Route path="/import" element={<Import />} />
            <Route path="/bar" element={<Operator />} />
            <Route path="/tasters" element={<Tasters />} />
            <Route path="/share" element={<Share />} />
            <Route path="/account" element={<Account />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>

        <nav className="bottomnav">{nav}</nav>
      </div>
    </div>
  );
}
