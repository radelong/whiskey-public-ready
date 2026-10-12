import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type BottleDetail as Detail } from "../api";
import { bottleLine, money, poursLeft } from "../lib";
import { Badge, Button, Card, EmptyState, Loading, PageHeader, RatingBadge, useToast } from "../components/ui";
import { CellarIcon, GlassIcon } from "../components/icons";
import { compressBottlePhoto } from "../bottle-photo";

export default function BottleDetail() {
  const { id } = useParams();
  const [bottle, setBottle] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photoSaving, setPhotoSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api.bottle(id!).then(setBottle).catch((e) => setError((e as Error).message));
  }, [id]);

  async function addBottlePhoto(file: File | undefined) {
    if (!file || !bottle || bottle.photo_url) return;
    setPhotoSaving(true);
    try {
      const photo_url = await compressBottlePhoto(file);
      const updated = await api.updateBottle(bottle.id, { photo_url }, bottle.version);
      setBottle((current) => current ? { ...current, ...updated } : current);
      setBottle((current) => current ? { ...current, photo_url } : current);
      toast("Bottle photo added");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setPhotoSaving(false);
    }
  }

  if (error) return <div className="error-text">{error}</div>;
  if (!bottle) return <Loading />;

  return (
    <>
      <PageHeader
        title={bottle.name}
        subtitle={bottleLine(bottle)}
        actions={
          <>
            {bottle.status !== "finished" && (
              <Link to={"/bar?bottle=" + bottle.id}>
                <Button variant="primary"><GlassIcon /> Log pour</Button>
              </Link>
            )}
            <a href="#tastings"><Button variant="secondary">View tastings</Button></a>
            <Link to={"/bottle/" + bottle.id + "/edit"}><Button variant="ghost">Edit</Button></Link>
          </>
        }
      />

      <div className="bottle-detail-grid">
        <Card>
          <div className="bottle-detail-hero">
            {!bottle.photo_url ? (
              <label
                className="bottle-detail-image"
                title="Take a bottle photo"
                style={{ cursor: photoSaving ? "wait" : "pointer", position: "relative", overflow: "hidden" }}
              >
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  disabled={photoSaving}
                  onChange={(event) => {
                    void addBottlePhoto(event.target.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                  style={{ position: "absolute", inset: 0, opacity: 0, cursor: "inherit" }}
                />
                <CellarIcon />
                <span style={{ position: "absolute", bottom: 16, left: 0, right: 0, textAlign: "center", fontSize: 12, fontWeight: 700 }}>
                  {photoSaving ? "Saving photo…" : "Add photo"}
                </span>
              </label>
            ) : (
              <div className="bottle-detail-image" style={{ backgroundImage: "url(" + bottle.photo_url + ")" }} />
            )}
            <div className="stack" style={{ flex: 1 }}>
              <div><Badge kind={bottle.status}>{bottle.status}</Badge></div>
              <div>
                <div className="faint detail-label">Remaining</div>
                <b>
                  {bottle.status === "sealed"
                    ? "Full · " + bottle.size_ml + " ml"
                    : poursLeft(bottle.remaining_ml, bottle.size_ml)}
                </b>
              </div>
              {bottle.status === "open" && (
                <div className="meter">
                  <i style={{ width: Math.max(0, Math.min(100, ((bottle.remaining_ml ?? 0) / bottle.size_ml) * 100)) + "%" }} />
                </div>
              )}
            </div>
          </div>
        </Card>

        <Card title="Bottle details">
          <dl className="detail-list">
            <div><dt>Purchased</dt><dd>{bottle.purchase_date || "—"}</dd></div>
            <div><dt>Price</dt><dd>{money(bottle.purchase_price)}</dd></div>
            <div><dt>Storage</dt><dd>{bottle.location || "—"}</dd></div>
            <div><dt>Size</dt><dd>{bottle.size_ml} ml</dd></div>
          </dl>
          {bottle.notes && <p className="muted" style={{ marginBottom: 0 }}>{bottle.notes}</p>}
        </Card>
      </div>

      <h2 id="tastings" style={{ fontSize: 15, margin: "26px 0 12px" }}>Pours and tastings</h2>
      {bottle.tastings.length === 0 ? (
        <EmptyState icon={<GlassIcon />} title="No pours logged yet" />
      ) : (
        <div className="stack">
          {bottle.tastings.map((t) => (
            <Card key={t.id}>
              <div className="row-between">
                <div>
                  <b>{t.taster_name || "House pour"}</b>
                  <div className="faint" style={{ fontSize: 12 }}>
                    {t.pour_ml} ml · {t.created_at.slice(0, 10)}
                  </div>
                </div>
                {t.rating != null && <RatingBadge value={t.rating} />}
              </div>
              {(t.nose || t.palate || t.finish || t.notes) && (
                <div className="faint" style={{ fontSize: 12.5, marginTop: 6 }}>
                  {[
                    t.nose && "Nose: " + t.nose,
                    t.palate && "Palate: " + t.palate,
                    t.finish && "Finish: " + t.finish,
                    t.notes,
                  ].filter(Boolean).join(" — ")}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
