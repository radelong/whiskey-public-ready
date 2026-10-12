import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useTaster } from "../../taster";
import { Loading } from "../../components/ui";
import { CellarIcon, GlassIcon, SparkleIcon, UserIcon } from "../../components/icons";
import Whiskeys from "./Whiskeys";
import DistilleryBottles from "./DistilleryBottles";
import WhiskeyDetail from "./WhiskeyDetail";
import MyNotes from "./MyNotes";
import TasterAccount from "./TasterAccount";
import Recommendations from "./Recommendations";

export default function TastingApp() {
  const { base, ready, taster } = useTaster();
  const home = base || "/";

  return (
    <div className="tasting-app">
      <header className="tasting-head">
        <NavLink to={home} end className="brand" style={{ padding: 0, fontSize: 15 }}>
          <span className="mark" style={{ width: 26, height: 26 }}>
            <GlassIcon />
          </span>
          <span>
            Whiskey Cellar
            <small>Tasting notes</small>
          </span>
        </NavLink>
        <NavLink to={`${base}/account`} className="faint" style={{ fontSize: 12.5 }}>
          {taster ? (taster.display_name ?? taster.username) : "Sign in"}
        </NavLink>
      </header>

      <main className="tasting-body">
        {!ready ? (
          <Loading />
        ) : (
          <Routes>
            <Route index element={<Whiskeys />} />
            <Route
              path="distillery/:name"
              element={taster ? <DistilleryBottles /> : <Navigate to={`${base}/account`} replace />}
            />
            <Route
              path="w/:id"
              element={taster ? <WhiskeyDetail /> : <Navigate to={`${base}/account`} replace />}
            />
            <Route
              path="recommendations"
              element={taster ? <Recommendations /> : <Navigate to={`${base}/account`} replace />}
            />
            <Route
              path="notes"
              element={taster ? <MyNotes /> : <Navigate to={`${base}/account`} replace />}
            />
            <Route path="account" element={<TasterAccount />} />
            <Route path="*" element={<Navigate to={home} replace />} />
          </Routes>
        )}
      </main>

      <nav className="tasting-nav">
        <NavLink to={home} end className="nav-link">
          <CellarIcon /> Whiskeys
        </NavLink>
        <NavLink to={`${base}/notes`} className="nav-link">
          <GlassIcon /> My notes
        </NavLink>
        {taster && (
          <NavLink to={`${base}/recommendations`} className="nav-link">
            <SparkleIcon /> Recommendations
          </NavLink>
        )}
        <NavLink to={`${base}/account`} className="nav-link">
          <UserIcon /> Account
        </NavLink>
      </nav>
    </div>
  );
}
