require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { MailtrapClient } = require("mailtrap");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const MAILTRAP_TOKEN = process.env.MAILTRAP_API_TOKEN;
const MAIL_FROM_EMAIL = process.env.MAIL_FROM_EMAIL || "noreply@gsmsolution.co.in";
const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || "GSM Solution";
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_S = 60;

if (!MAILTRAP_TOKEN) {
  console.error("❌ MAILTRAP_API_TOKEN is missing in env");
  process.exit(1);
}

const mailtrap = new MailtrapClient({ token: MAILTRAP_TOKEN });

const store = new Map();
const makeCode = () => String(Math.floor(100000 + Math.random() * 900000));

app.get("/", (_req, res) => {
  res.send("✅ GSM verification API is running (Live).");
});

app.post("/api/send-code", async (req, res) => {
  try {
    const { email, name } = req.body || {};
    console.log("→ send-code for:", email);

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: "Invalid email address." });
    }

    const key = email.toLowerCase().trim();
    const now = Date.now();
    const existing = store.get(key);

    if (existing && now - existing.lastSentAt < RESEND_COOLDOWN_S * 1000) {
      const wait = Math.ceil((RESEND_COOLDOWN_S * 1000 - (now - existing.lastSentAt)) / 1000);
      return res.status(429).json({ success: false, message: `Please wait ${wait} seconds.` });
    }

    const code = makeCode();
    store.set(key, { code, expires: now + CODE_TTL_MS, attempts: 0, lastSentAt: now });

    await mailtrap.send({
      from: { email: MAIL_FROM_EMAIL, name: MAIL_FROM_NAME },
      to: [{ email }],
      subject: "Your GSM Solution verification code",
      text: `Hi ${name || "there"}, your code is: ${code}. Expires in 10 min.`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px">
          <h2 style="color:#0a1124">GSM Solution</h2>
          <p>Hi ${name || "there"},</p>
          <p>Your verification code is:</p>
          <p style="font-size:34px;font-weight:bold;letter-spacing:10px;color:#2563eb;margin:18px 0">${code}</p>
          <p>This code expires in <strong>10 minutes</strong>.</p>
        </div>
      `,
      category: "Email verification"
    });

    console.log("✅ email sent. Code:", code);
    res.json({ success: true, cooldown: RESEND_COOLDOWN_S });

  } catch (err) {
    console.error("❌ send-code error:", err.message);
    res.status(500).json({ success: false, message: "Could not send the email." });
  }
});

app.post("/api/verify-code", (req, res) => {
  const { email, code } = req.body || {};
  if (!email || !code) return res.status(400).json({ success: false, message: "Missing email or code." });
  const key = email.toLowerCase().trim();
  const entry = store.get(key);
  if (!entry) return res.status(400).json({ success: false, message: "No code sent to this email." });
  if (Date.now() > entry.expires) { store.delete(key); return res.status(400).json({ success: false, message: "Code expired." }); }
  if (entry.attempts >= MAX_ATTEMPTS) { store.delete(key); return res.status(429).json({ success: false, message: "Too many attempts." }); }
  entry.attempts += 1;
  if (entry.code !== String(code)) return res.status(400).json({ success: false, message: `Incorrect code. ${MAX_ATTEMPTS - entry.attempts} attempts left.` });
  store.delete(key);
  const token = Buffer.from(`${key}:${Date.now()}`).toString("base64");
  res.json({ success: true, token });
});

app.listen(PORT, () => console.log(`🚀 Live API running on port ${PORT}`));
