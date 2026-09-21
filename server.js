require("dotenv").config();
const express = require("express");
const cors    = require("cors");
const path    = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const SCRIPT_URL = process.env.APPS_SCRIPT_URL;

if (!SCRIPT_URL) {
  console.error("❌  APPS_SCRIPT_URL is not set. Add it to your .env or Render environment.");
  process.exit(1);
}

app.use(cors());
app.use(express.json());
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

// ── Serve frontend ────────────────────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`✅  Demo Tracker running on port ${PORT}`);
  console.log(`   Apps Script: ${SCRIPT_URL.substring(0, 60)}...`);
});
