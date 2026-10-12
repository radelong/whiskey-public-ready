import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../api";
import type { Bottle } from "../../../shared/types";
import { flavorSummary } from "../../../shared/flavors";
import { proof } from "../../lib";
import { useTaster } from "../../taster";
import { EmptyState, Field, Loading, RatingBadge } from "../../components/ui";
import { CellarIcon, DistilleryIcon } from "../../components/icons";
import { filterWhiskeys, type ProofBand } from "./whiskeyFilters";
import { distilleryImage } from "./distilleryImages";

export default function DistilleryBottles() {
  const { base, taster } = useTaster();
  const { name = "" } = useParams();
  const [bottles, setBottles] = useState<Bottle[] | null>(null);
  const [query, setQuery] = useState("");
  const [proofBand, setProofBand] = useState<ProofBand>("all");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!taster) return;
    let cancelled = false;
    api
      .bottles()
      .then((rows) => {
        if (!cancelled) setBottles(rows.filter((bottle) => bottle.status !== "finished"));
      })
      .catch((error) => {
        if (!cancelled) {
          setErr((error as Error).message);
          setBottles([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [taster]);

  const shown = useMemo(
    () => filterWhiskeys(bottles ?? [], { query, distillery: name, proofBand }),
    [bottles, name, proofBand, query],
  );

  return (
    <>
      <Link to={base || "/"} className="faint" style={{ fontSize: 12.5 }}>
        ← All distilleries
      </Link>
      <div className="distillery-heading">
        {distilleryImage(name) ? (
            <img className="distillery-heading-image" src={distilleryImage(name)!} alt="" loading="lazy" />
        ) : (
          <DistilleryIcon name={name} />
        )}
        <div>
          <h1 className="tasting-title" style={{ margin: 0 }}>{name}</h1>
          <p className="muted" style={{ fontSize: 13, margin: "3px 0 0" }}>
            Choose a bottle to request a pour.
          </p>
          <a
            href={`/api/distillery-site/${encodeURIComponent(name)}`}
            target="_blank"
            rel="noreferrer"
            className="distillery-website-link"
          >
            Visit {name} website ↗
          </a>
        </div>
      </div>

      <Field label="Search this distillery">
        <input
          placeholder="Search bottles…"
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

      {err && <div className="error-text">{err}</div>}

      {bottles === null ? (
        <Loading />
      ) : shown.length === 0 ? (
        <EmptyState icon={<CellarIcon />} title="No bottles found" />
      ) : (
        <div className="bottle-grid" aria-label={`${name} bottles`}>
          {shown.map((bottle) => (
            <div key={bottle.id} className="bottle-tile">
              <Link
                to={`${base}/w/${bottle.id}`}
                className="bottle-tile-image"
                aria-label={`View ${bottle.name}`}
              >
                {bottle.photo_url ? <img src={bottle.photo_url} alt={bottle.name} loading="lazy" /> : <CellarIcon />}
              </Link>
              <a
                className="bottle-tile-name"
                href={`/api/whiskybase/${bottle.id}`}
                target="_blank"
                rel="noreferrer"
                title={`Open ${bottle.name} on Whiskybase`}
              >
                {bottle.name}
              </a>
              <span className="bottle-tile-meta">
                {[bottle.category, proof(bottle.abv)].filter(Boolean).join(" · ") || "Whiskey"}
              </span>
              {flavorSummary(bottle.flavor_profile) && (
                <span className="bottle-tile-flavors" aria-label="Internet tasting note">
                  {flavorSummary(bottle.flavor_profile, bottle.flavor_source)}
                  {bottle.flavor_source_url && <> <a href={bottle.flavor_source_url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>Source ↗</a></>}
                </span>
              )}
              <RatingBadge value={bottle.avg_rating ?? null} count={bottle.rating_count ?? undefined} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
