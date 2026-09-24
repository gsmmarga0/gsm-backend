require("dotenv").config();

const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");

const app = express();
app.use(cors());
app.use(express.json());

const PORT              = process.env.PORT || 3000;
const SMTP_HOST         = process.env.SMTP_HOST   || "sandbox.smtp.mailtrap.io";
const SMTP_PORT         = process.env.SMTP_PORT   || 2525;
const SMTP_USER         = process.env.SMTP_USER   || "1a9b0770837440";
const SMTP_PASS         = process.env.SMTP_PASS   || "e178343ed83979";
const MAIL_FROM_EMAIL   = process.env.MAIL_FROM_EMAIL || "test@gsmsolution.com";
const MAIL_FROM_NAME    = process.env.MAIL_FROM_NAME  || "GSM Solution";
const CODE_TTL_MS       = 10 * 60 * 1000;
const MAX_ATTEMPTS      = 5;
const RESEND_COOLDOWN_S = 60;

console.log("=== GSM backend booting ===");
console.log("SMTP_HOST:", SMTP_HOST);
console.log("SMTP_PORT:", SMTP_PORT);
console.log("SMTP_USER:", SMTP_USER ? "set" : "MISSING");
console.log("SMTP_PASS:", SMTP_PASS ? "set" : "MISSING");

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT),
  auth: { user: SMTP_USER, pass: SMTP_PASS }
});

// Verify SMTP connection on boot
transporter.verify(function (err, success) {
  if (err) {
    console.error("❌ SMTP verify failed:", err.message);
  } else {
    console.log("✅ SMTP connection verified — ready to send emails");
  }
});

const store = new Map();
const makeCode = () => String(Math.floor(100000 + Math.random() * 900000));

app.get("/", (_req, res) => {
  res.send("✅ GSM verification API is running.");
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
      return res.status(429).json({
        success: false,
        message: `Please wait ${wait} seconds before requesting another code.`
      });
    }

    const code = makeCode();
    store.set(key, {
      code,
      expires: now + CODE_TTL_MS,
      attempts: 0,
      lastSentAt: now
    });

    console.log("→ sending email via SMTP…");
    const info = await transporter.sendMail({
      from: `"${MAIL_FROM_NAME}" <${MAIL_FROM_EMAIL}>`,
      to: email,
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
      `
    });

    console.log("✅ email sent. messageId:", info.messageId);
    console.log("✅ Code:", code);

    res.json({ success: true, cooldown: RESEND_COOLDOWN_S });

  } catch (err) {
    console.error("❌ send-code error:", err.message || err);
    res.status(500).json({
      success: false,
      message: "Could not send the email: " + (err.message || "unknown error")
    });
  }
});

app.post("/api/verify-code", (req, res) => {
  const { email, code } = req.body || {};
  if (!email || !code) {
    return res.status(400).json({ success: false, message: "Missing email or code." });
  }
  const key = email.toLowerCase().trim();
  const entry = store.get(key);
  if (!entry) return res.status(400).json({ success: false, message: "No code was sent to this email." });
  if (Date.now() > entry.expires) { store.delete(key); return res.status(400).json({ success: false, message: "Code expired." }); }
  if (entry.attempts >= MAX_ATTEMPTS) { store.delete(key); return res.status(429).json({ success: false, message: "Too many attempts." }); }
  entry.attempts += 1;
  if (entry.code !== String(code)) {
    return res.status(400).json({ success: false, message: `Incorrect code. ${MAX_ATTEMPTS - entry.attempts} attempts left.` });
  }
  store.delete(key);
  const token = Buffer.from(`${key}:${Date.now()}`).toString("base64");
  res.json({ success: true, token });
});

app.listen(PORT, () => {
  console.log(`🚀 GSM verification API running on port ${PORT}`);
});
