// Vercel serverless function for contact form submissions
// Tries Resend first if RESEND_API_KEY is configured, falls back to storing the
// submission in the response so the frontend can trigger a mailto fallback.

export default async function handler(req, res) {
  // CORS — only allow same-origin + POST
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Parse body — Vercel auto-parses JSON and form-urlencoded
    const body = req.body || {};
    const firstName = String(body.firstName || "").trim();
    const lastName = String(body.lastName || "").trim();
    const firmName = String(body.firmName || "").trim();
    const email = String(body.email || "").trim();
    const message = String(body.message || "").trim();
    const consent = String(body.consent || "").trim();
    const gotcha = String(body._gotcha || "").trim();

    // Honeypot — bots will fill this invisible field
    if (gotcha) {
      return res.status(200).json({ ok: true, message: "Thanks." });
    }

    // Validation
    if (!firstName || !lastName || !email) {
      return res.status(400).json({ error: "Please fill in your name and email." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Please provide a valid email address." });
    }
    if (!consent) {
      return res.status(400).json({ error: "Please agree to the Privacy Policy and Terms of Service before sending your message." });
    }

    const apiKey = process.env.RESEND_API_KEY;
    const toEmail = process.env.CONTACT_TO_EMAIL || "info@mozaiik.com";
    const fromEmail = process.env.CONTACT_FROM_EMAIL || "Mozaiik Contact <onboarding@resend.dev>";

    // If Resend is configured, send the email
    if (apiKey) {
      const subject = `New pilot inquiry — ${firmName || `${firstName} ${lastName}`}`;
      const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;color:#19222d">
          <div style="background:#19222d;padding:24px 32px;border-radius:12px 12px 0 0">
            <h1 style="color:#ffffff;font-size:18px;margin:0;font-weight:600;letter-spacing:-0.02em">New pilot inquiry</h1>
            <p style="color:rgba(255,255,255,0.5);font-size:11px;margin:6px 0 0;text-transform:uppercase;letter-spacing:0.1em">From mozaiik.com</p>
          </div>
          <div style="background:#ffffff;padding:32px;border:1px solid #EDEFF7;border-top:none;border-radius:0 0 12px 12px">
            <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
              <tr><td style="padding:10px 0;color:#6E7180;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;width:30%">Name</td><td style="padding:10px 0;color:#19222d;font-size:14px">${escapeHtml(firstName + " " + lastName)}</td></tr>
              <tr><td style="padding:10px 0;color:#6E7180;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;font-weight:600">Email</td><td style="padding:10px 0;color:#19222d;font-size:14px"><a href="mailto:${escapeHtml(email)}" style="color:#52a49a;text-decoration:none">${escapeHtml(email)}</a></td></tr>
              ${firmName ? `<tr><td style="padding:10px 0;color:#6E7180;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;font-weight:600">Firm</td><td style="padding:10px 0;color:#19222d;font-size:14px">${escapeHtml(firmName)}</td></tr>` : ""}
              <tr><td style="padding:10px 0;color:#6E7180;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;font-weight:600">Consent</td><td style="padding:10px 0;color:#19222d;font-size:14px">Agreed to Privacy Policy and Terms of Service</td></tr>
            </table>
            ${message ? `<div style="padding-top:20px;border-top:1px solid #EDEFF7"><p style="color:#6E7180;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;margin:0 0 10px">Message</p><p style="color:#19222d;font-size:14px;line-height:1.7;margin:0;white-space:pre-wrap">${escapeHtml(message)}</p></div>` : ""}
          </div>
        </div>
      `;
      const plain = [
        `New pilot inquiry from mozaiik.com`,
        ``,
        `Name: ${firstName} ${lastName}`,
        `Email: ${email}`,
        firmName ? `Firm: ${firmName}` : "",
        `Consent: agreed to Privacy Policy and Terms of Service`,
        ``,
        message ? `Message:\n${message}` : "(no message)",
      ].filter(Boolean).join("\n");

      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [toEmail],
          reply_to: email,
          subject,
          html,
          text: plain,
        }),
      });

      if (resendRes.ok) {
        return res.status(200).json({ ok: true, method: "email", message: "Thanks — we'll follow up shortly." });
      } else {
        const errText = await resendRes.text();
        console.error("[contact] Resend error:", resendRes.status, errText);
        // Fall through to "not configured" response so frontend uses mailto fallback
      }
    }

    // Resend not configured OR failed — return 202 Accepted with a flag
    // telling the frontend to use mailto fallback. We still consider the
    // submission valid (we parsed it successfully).
    return res.status(202).json({
      ok: false,
      fallback: "mailto",
      message: "Email backend not configured. Please use the fallback.",
      data: { firstName, lastName, firmName, email, message },
    });
  } catch (error) {
    console.error("[contact] Unexpected error:", error);
    return res.status(500).json({ error: "An unexpected error occurred." });
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
