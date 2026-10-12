import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Button, Card, PageHeader, useToast } from "../components/ui";

const GUEST_URL = typeof window === "undefined" ? "http://localhost:5173/guest" : new URL("/guest", window.location.origin).href;

export default function Share() {
  const [qr, setQr] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    QRCode.toDataURL(GUEST_URL, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 640,
      color: { dark: "#241304", light: "#f2e3cd" },
    })
      .then(setQr)
      .catch(() => setQr(null));
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(GUEST_URL);
      toast("Link copied");
    } catch {
      toast("Couldn't copy — long-press the link");
    }
  }

  return (
    <>
      <PageHeader
        title="Guest access"
        subtitle="Share this so guests can sign in and request a pour"
      />

      <Card>
        <div className="share-grid">
          <div className="qr-frame">
            {qr ? <img src={qr} alt="QR code for the guest page" /> : <div className="qr-skeleton" />}
          </div>

          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="card-title" style={{ marginBottom: 6 }}>
              {new URL(GUEST_URL).host}
            </div>
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
              Point a phone camera at the code, or send the link. It opens straight to the
              request page.
            </p>
            <div className="actions" style={{ marginTop: 14 }}>
              <Button variant="primary" onClick={copy}>
                Copy link
              </Button>
              <a href={GUEST_URL} target="_blank" rel="noreferrer">
                <Button variant="secondary">Open</Button>
              </a>
              {qr && (
                <a href={qr} download="tasting-guest-qr.png">
                  <Button variant="secondary">Download QR</Button>
                </a>
              )}
            </div>
          </div>
        </div>
      </Card>

      <Card title="Tip">
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          Print the QR and set it by the bottles. Requests show up on the{" "}
          <strong>Bar</strong> screen as guests submit them.
        </p>
      </Card>
    </>
  );
}
