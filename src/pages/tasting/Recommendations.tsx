import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { WhiskeyRecommendation } from "../../../shared/types";
import { flavorSummary } from "../../../shared/flavors";
import { api } from "../../api";
import { useTaster } from "../../taster";
import { Button, Card, EmptyState, Loading, RatingBadge } from "../../components/ui";
import { CellarIcon, SparkleIcon } from "../../components/icons";

export default function Recommendations() {
  const { base } = useTaster();
  const [data, setData] = useState<{ has_ratings: boolean; profiled_bottles: number; profiled_reviews: number; recommendations: WhiskeyRecommendation[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prompted = useRef(false);

  useEffect(() => {
    api.recommendations().then(setData).catch((e) => setError((e as Error).message));
  }, []);

  useEffect(() => {
    if (data && !data.has_ratings && !prompted.current) {
      prompted.current = true;
      window.alert("no past reviews to base recommendations");
    }
  }, [data]);

  if (error) return <div className="error-text">{error}</div>;
  if (!data) return <Loading />;
  if (!data.has_ratings) {
    return <EmptyState icon={<SparkleIcon />} title="Recommendations">
      no past reviews to base recommendations
    </EmptyState>;
  }
  if (data.recommendations.length === 0) {
    return <EmptyState icon={<CellarIcon />} title="No flavor matches available">
      {data.profiled_bottles === 0 || data.profiled_reviews === 0
        ? "Flavor profiles are not available yet for the bottles you reviewed. The cellar owner can look up or enter bottle flavor profiles; bottles without profiles are not guessed."
        : "There are no unrated, available bottles with a matching flavor profile right now."}
    </EmptyState>;
  }

  return (
    <>
      <h1 className="tasting-title">Recommendations</h1>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Based on flavors in bottles you rated highly. Previously rated and unavailable bottles are excluded.
      </p>
      <div className="stack">
        {data.recommendations.map(({ bottle, reasons }) => (
          <Card key={bottle.id}>
            <div className="row-between" style={{ gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <Link to={`${base}/w/${bottle.id}`} className="name">{bottle.name}</Link>
                <div className="faint" style={{ fontSize: 12, marginTop: 3 }}>
                  {[bottle.distillery, bottle.category, bottle.abv != null ? `${Math.round(bottle.abv * 2)} proof` : null].filter(Boolean).join(" · ")}
                </div>
                {flavorSummary(bottle.flavor_profile) && (
                  <div className="faint" style={{ fontSize: 11.5, marginTop: 5 }}>
                    {flavorSummary(bottle.flavor_profile, bottle.flavor_source)}
                    {bottle.flavor_source_url && <> <a href={bottle.flavor_source_url} target="_blank" rel="noreferrer">Source ↗</a></>}
                  </div>
                )}
              </div>
              <RatingBadge value={bottle.avg_rating ?? null} count={bottle.rating_count ?? undefined} />
            </div>
            {reasons.length > 0 && (
              <p className="muted" style={{ fontSize: 12.5, margin: "10px 0 0" }}>
                Flavor match: {reasons.join(", ")}
              </p>
            )}
          </Card>
        ))}
      </div>
      <p className="faint" style={{ fontSize: 11, marginTop: 14 }}>
        Proof shown here comes from the cellar’s manually entered bottle data; recommendations never edit it.
      </p>
      <Link to={base || "/"}><Button variant="ghost">Back to distilleries</Button></Link>
    </>
  );
}
