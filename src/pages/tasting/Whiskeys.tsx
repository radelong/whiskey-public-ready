import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import type { Bottle } from "../../../shared/types";
import { useTaster } from "../../taster";
import { Button, EmptyState, Field, Loading, RatingBadge } from "../../components/ui";
import { CellarIcon, DistilleryIcon, SparkleIcon } from "../../components/icons";
import { distilleryGroups, filterWhiskeys, type ProofBand } from "./whiskeyFilters";
import { distilleryImage } from "./distilleryImages";

export default function Whiskeys() {
  const { base, taster } = useTaster();
  const [bottles, setBottles] = useState<Bottle[] | null>(null);
  const [query, setQuery] = useState("");
  const [proofBand, setProofBand] = useState<ProofBand>("all");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!taster) {
      setBottles(null);
      setErr(null);
      return;
    }

    let cancelled = false;
    api
      .bottles()
      .then((b) => {
        if (!cancelled) setBottles(b.filter((x) => x.status !== "finished"));
      })
      .catch((e) => {
        if (!cancelled) {
          setErr((e as Error).message);
          setBottles([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [taster]);

  const filteredBottles = useMemo(
    () => filterWhiskeys(bottles ?? [], { query, distillery: "", proofBand }),
    [bottles, proofBand, query],
  );
  const distilleries = useMemo(
    () => distilleryGroups(bottles ?? [], filteredBottles),
    [bottles, filteredBottles],
  );

  if (!taster) {
    return (
      <>
        <h1 className="tasting-title">Whiskeys</h1>
        <EmptyState
          icon={<CellarIcon />}
          title="Sign in to browse whiskeys"
          action={
            <Link to={`${base}/account`}>
              <Button variant="primary">Sign in / create account</Button>
            </Link>
          }
        >
          Create an account to browse the cellar, filter bottles, and save tasting notes.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <h1 className="tasting-title">Whiskeys</h1>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Choose a distillery to browse its bottles and request a pour.
      </p>

      <Field label="Find a distillery or bottle">
        <input
          placeholder="Search distilleries or bottles…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </Field>
      <Field label="Proof">
        <select value={proofBand} onChange={(event) => setProofBand(event.target.value as ProofBand)}>
          <option value="all">All proofs</option>
          <option value="under-90">&lt;89</option>
          <option value="90-99">90–99</option>
          <option value="100-119">100–119</option>
          <option value="120-plus">&gt;119</option>
        </select>
      </Field>
      <Link to={`${base}/recommendations`} style={{ alignSelf: "flex-start" }}>
        <Button variant="secondary"><SparkleIcon /> Recommendations</Button>
      </Link>

      {err && <div className="error-text">{err}</div>}

      {bottles === null ? (
        <Loading />
      ) : distilleries.length === 0 ? (
        <EmptyState icon={<CellarIcon />} title="Nothing to show" />
      ) : (
        <div className="distillery-grid" aria-label="Distilleries">
          {distilleries.map((distillery) => (
            <Link
              key={distillery.name}
              to={`${base}/distillery/${encodeURIComponent(distillery.name)}`}
              className="distillery-tile"
            >
              {distilleryImage(distillery.name) ? (
                <img className="distillery-tile-image" src={distilleryImage(distillery.name)!} alt="" loading="lazy" />
              ) : (
                <DistilleryIcon name={distillery.name} />
              )}
              <span className="distillery-tile-name">{distillery.name}</span>
              <span className="distillery-tile-count">{distillery.count} bottle{distillery.count === 1 ? "" : "s"}</span>
              <RatingBadge value={distillery.avg_rating} count={distillery.rating_count} />
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
