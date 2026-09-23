require("dotenv").config();
const express  = require("express");
const cors     = require("cors");
const path     = require("path");
const multer   = require("multer");

const app = express();
const PORT        = process.env.PORT        || 3000;
const SCRIPT_URL  = process.env.APPS_SCRIPT_URL;
const GEMINI_KEY  = process.env.GEMINI_API_KEY;

if (!SCRIPT_URL) {
  console.error("❌  APPS_SCRIPT_URL is not set. Add it to your .env or Render environment.");
  process.exit(1);
}

// multer: store file in memory, max 10MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

app.use(cors());
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ limit: "15mb", extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ── Proxy helper ──────────────────────────────────────────────────────────────
async function scriptGet(params = {}) {
  const url = new URL(SCRIPT_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { redirect: "follow" });
  if (!res.ok) throw new Error(`Apps Script returned ${res.status}`);
  return res.json();
}

async function scriptPost(body) {
  const res = await fetch(SCRIPT_URL, {
    method:   "POST",
    redirect: "follow",
    headers:  { "Content-Type": "application/json" },
    body:     JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Apps Script returned ${res.status}`);
  return res.json();
}

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ ok: true, scriptConnected: !!SCRIPT_URL, ts: new Date().toISOString() });
});

// ── Units ─────────────────────────────────────────────────────────────────────
app.get("/api/units", async (req, res) => {
  try {
    const data = await scriptGet({ action: "getAll" });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/units", async (req, res) => {
  try {
    const data = await scriptPost({ action: "add", data: req.body });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/units/:id", async (req, res) => {
  try {
    const data = await scriptPost({ action: "update", id: req.params.id, data: req.body });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch("/api/units/:id/return", async (req, res) => {
  try {
    const { date, notes } = req.body;
    const data = await scriptPost({ action: "markReturned", id: req.params.id, date, notes });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/units/:id", async (req, res) => {
  try {
    const data = await scriptPost({ action: "delete", id: req.params.id });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Logs ──────────────────────────────────────────────────────────────────────
app.get("/api/logs", async (req, res) => {
  try {
    const data = await scriptGet({ action: "getLogs" });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Scan challan via Gemini ───────────────────────────────────────────────────
app.post("/api/scan", upload.single("file"), async (req, res) => {
  if (!GEMINI_KEY) return res.status(500).json({ error: "GEMINI_API_KEY not set on server." });
  if (!req.file)   return res.status(400).json({ error: "No file uploaded." });

  const { mimetype, buffer } = req.file;
  const base64 = buffer.toString("base64");

  // Build the Gemini request
  const prompt = `You are parsing a Panache DigiLife internal dispatch / delivery challan.
Extract every field you can find and return ONLY valid JSON — no markdown, no explanation.

Return this exact structure (use empty string "" for any field not found):
{
  "Product":        "",   // product / device name
  "Serial":         "",   // serial number or model number
  "Company":        "",   // recipient company name
  "Contact":        "",   // contact person name at recipient company
  "Phone":          "",   // contact phone number
  "Email":          "",   // contact email
  "SentBy":         "",   // dispatched by / sender name
  "DateSent":       "",   // dispatch date in YYYY-MM-DD format
  "ExpectedReturn": "",   // expected return date in YYYY-MM-DD format (if mentioned)
  "Purpose":        "",   // purpose of demo / dispatch reason
  "Courier":        "",   // courier name and/or tracking/AWB number
  "Notes":          ""    // any other relevant info
}`;

  // Determine Gemini part type
  const isImage = mimetype.startsWith("image/");
  const isPdf   = mimetype === "application/pdf";

  if (!isImage && !isPdf) {
    return res.status(400).json({ error: "Only image or PDF files are supported." });
  }

  const part = isImage
    ? { inlineData: { mimeType: mimetype, data: base64 } }
    : { inlineData: { mimeType: "application/pdf", data: base64 } };

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${GEMINI_KEY}`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              part,
            ]
          }],
          generationConfig: { temperature: 0, maxOutputTokens: 1024 }
        })
      }
    );

    if (!geminiRes.ok) {
      const err = await geminiRes.text();
      return res.status(500).json({ error: `Gemini error: ${err}` });
    }

    const geminiData = await geminiRes.json();
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Strip markdown fences if Gemini wraps in ```json
    const cleaned = rawText.replace(/```json|```/gi, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: "Gemini returned unexpected format.", raw: rawText });
    }

    res.json({ success: true, fields: parsed });

  } catch (e) {
    console.error("Scan error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Serve frontend ────────────────────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.use((err, req, res, next) => {
  if (err.type === "entity.too.large") {
    return res.status(413).json({
      error: "Image is too large. Please take a smaller photo or upload an image under 10 MB."
    });
  }

  console.error(err);

  res.status(500).json({
    error: err.message || "Internal server error"
  });
});
app.listen(PORT, () => {
  console.log(`✅  Demo Tracker running on port ${PORT}`);
  console.log(`   Apps Script: ${SCRIPT_URL.substring(0, 60)}...`);
});
