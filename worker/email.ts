// Sends the admin login code via Resend (https://resend.com).
//
// In Resend's default (no verified domain) mode you can only send *to* the
// address that owns the Resend account and *from* an @resend.dev address —
// which is exactly this use case: one code, to one fixed inbox.

interface SendResult {
  ok: boolean;
  error?: string;
}

export async function sendLoginCode(
  apiKey: string,
  to: string,
  code: string,
): Promise<SendResult> {
  const body = {
    from: "Whiskey Cellar <onboarding@resend.dev>",
    to: [to],
    subject: `${code} is your Whiskey Cellar login code`,
    text: `Your Whiskey Cellar admin login code is ${code}\n\nIt expires in 10 minutes. If you didn't request it, ignore this email.`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:0 auto">
  <h2 style="margin:0 0 4px">Whiskey Cellar</h2>
  <p style="color:#666;margin:0 0 20px">Admin login code</p>
  <div style="font-size:34px;font-weight:700;letter-spacing:8px;background:#f5efe6;border-radius:10px;padding:18px;text-align:center">${code}</div>
  <p style="color:#888;font-size:13px;margin-top:20px">Expires in 10 minutes. If you didn't request this, you can ignore it.</p>
</div>`,
  };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const detail = await res.text().catch(() => "");
    return { ok: false, error: `Resend ${res.status}: ${detail.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
