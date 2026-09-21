require("dotenv").config();
const express    = require("express");
const cors       = require("cors");
const path       = require("path");
const { google } = require("googleapis");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Google Sheets Auth ────────────────────────────────────────────────────────
// Credentials come from env var GOOGLE_SERVICE_ACCOUNT_JSON (the full JSON string)
// OR from a local file path GOOGLE_KEY_FILE (for local dev)
function getAuth() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  }
  if (process.env.GOOGLE_KEY_FILE) {
    return new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_KEY_FILE,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  }
  throw new Error("No Google credentials configured. Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_KEY_FILE.");
}

const SHEET_ID     = process.env.GOOGLE_SHEET_ID;
const UNITS_SHEET  = "Demo Units";
const LOG_SHEET    = "Activity Log";

// Column order for Demo Units sheet
const COLS = [
  "ID", "Product", "Serial", "Company", "Contact", "ContactInfo",
  "SentBy", "DateSent", "ExpectedReturn", "ActualReturn",
  "Purpose", "Status", "Courier", "Notes", "CreatedAt", "UpdatedAt"
];

// ── Sheet helpers ─────────────────────────────────────────────────────────────
async function getSheets() {
  const auth   = getAuth();
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

// Ensure a worksheet tab exists with the right header row
async function ensureSheet(sheets, name, headers) {
  try {
    // Try to read first row
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${name}!1:1`,
    });
    if (!res.data.values || !res.data.values.length) {
      // Sheet exists but is empty — write headers
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${name}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [headers] },
      });
    }
  } catch {
    // Sheet doesn't exist — create it
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: name } } }],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${name}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
  }
}

// Read all rows (excluding header) as array of objects
async function readRows(sheets, sheetName, cols) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}`,
  });
  const rows = res.data.values || [];
  if (rows.length <= 1) return [];
  return rows.slice(1).map(row => {
    const obj = {};
    cols.forEach((c, i) => { obj[c] = row[i] !== undefined ? row[i] : ""; });
    return obj;
  });
}

// Convert object to row array matching COLS order
function objToRow(obj, cols) {
  return cols.map(c => obj[c] !== undefined ? obj[c] : "");
}

// Find 1-based row index for a unit by ID (returns -1 if not found)
async function findRowIndex(sheets, id) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${UNITS_SHEET}!A:A`,
  });
  const col = res.data.values || [];
  for (let i = 1; i < col.length; i++) {
    if (col[i][0] === id) return i + 1; // 1-based, skip header
  }
  return -1;
}

// Generate next unit ID: DU-001, DU-002, ...
async function generateId(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${UNITS_SHEET}!A:A`,
  });
  const rows = res.data.values || [];
  const count = Math.max(rows.length, 1); // at least 1 for header
  return `DU-${String(count).padStart(3, "0")}`;
}

// Append a row to the Activity Log
async function addLog(sheets, action, unitId, details, doneBy = "") {
  await ensureSheet(sheets, LOG_SHEET,
    ["Timestamp", "Action", "UnitID", "Details", "DoneBy"]);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${LOG_SHEET}!A:E`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[new Date().toISOString(), action, unitId, details, doneBy]],
    },
  });
}

// ── Status helper (server-side for stats) ─────────────────────────────────────
function computeStatus(unit) {
  if (unit.Status === "Returned") return "Returned";
  if (!unit.ExpectedReturn) return unit.Status || "Out";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const ret   = new Date(unit.ExpectedReturn + "T00:00:00");
  if (isNaN(ret)) return unit.Status || "Out";
  const days = Math.round((ret - today) / 86400000);
  if (days < 0)       return "Overdue";
  if (days <= 7)      return "Due Soon";
  if (unit.Status === "Extended") return "Extended";
  return "Out";
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Health check
app.get("/api/health", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString(), sheet: SHEET_ID || "NOT SET" });
});

// GET all units
app.get("/api/units", async (req, res) => {
  try {
    const sheets = await getSheets();
    await ensureSheet(sheets, UNITS_SHEET, COLS);
    const units = await readRows(sheets, UNITS_SHEET, COLS);
    res.json({ units });
  } catch (err) {
    console.error("GET /api/units:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET stats
app.get("/api/stats", async (req, res) => {
  try {
    const sheets = await getSheets();
    const units  = await readRows(sheets, UNITS_SHEET, COLS);
    let out = 0, overdue = 0, returned = 0, dueSoon = 0;
    units.forEach(u => {
      const s = computeStatus(u);
      if      (s === "Returned") returned++;
      else if (s === "Overdue")  overdue++;
      else if (s === "Due Soon") { out++; dueSoon++; }
      else                       out++;
    });
    res.json({ total: units.length, out, overdue, returned, dueSoon });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET activity log
app.get("/api/logs", async (req, res) => {
  try {
    const sheets = await getSheets();
    await ensureSheet(sheets, LOG_SHEET,
      ["Timestamp", "Action", "UnitID", "Details", "DoneBy"]);
    const LOG_COLS = ["Timestamp", "Action", "UnitID", "Details", "DoneBy"];
    const logs = await readRows(sheets, LOG_SHEET, LOG_COLS);
    res.json({ logs: logs.reverse() }); // newest first
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST add new unit
app.post("/api/units", async (req, res) => {
  try {
    const sheets = await getSheets();
    await ensureSheet(sheets, UNITS_SHEET, COLS);

    const data = req.body;
    const now  = new Date().toISOString();
    data.ID        = await generateId(sheets);
    data.CreatedAt = now;
    data.UpdatedAt = now;
    if (!data.Status) data.Status = "Out";

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${UNITS_SHEET}!A:P`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [objToRow(data, COLS)] },
    });

    await addLog(sheets, "ADD", data.ID,
      `Added: ${data.Product} → ${data.Company}`, data.SentBy);

    res.json({ success: true, id: data.ID });
  } catch (err) {
    console.error("POST /api/units:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT update a unit
app.put("/api/units/:id", async (req, res) => {
  try {
    const sheets = await getSheets();
    const { id }  = req.params;
    const rowIdx  = await findRowIndex(sheets, id);
    if (rowIdx === -1) return res.status(404).json({ error: "Unit not found" });

    const data = req.body;
    data.ID        = id;
    data.UpdatedAt = new Date().toISOString();

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${UNITS_SHEET}!A${rowIdx}:P${rowIdx}`,
      valueInputOption: "RAW",
      requestBody: { values: [objToRow(data, COLS)] },
    });

    await addLog(sheets, "UPDATE", id,
      `Updated: ${data.Product} → ${data.Company}`, data.SentBy || "");

    res.json({ success: true });
  } catch (err) {
    console.error("PUT /api/units:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH mark returned
app.patch("/api/units/:id/return", async (req, res) => {
  try {
    const sheets  = await getSheets();
    const { id }  = req.params;
    const { date, notes } = req.body;
    const rowIdx  = await findRowIndex(sheets, id);
    if (rowIdx === -1) return res.status(404).json({ error: "Unit not found" });

    // Read current row to preserve existing values
    const rowRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${UNITS_SHEET}!A${rowIdx}:P${rowIdx}`,
    });
    const row = rowRes.data.values[0] || [];
    const unit = {};
    COLS.forEach((c, i) => { unit[c] = row[i] || ""; });

    unit.Status       = "Returned";
    unit.ActualReturn = date || new Date().toISOString().split("T")[0];
    unit.UpdatedAt    = new Date().toISOString();
    if (notes) unit.Notes = unit.Notes ? unit.Notes + " | Return note: " + notes : notes;

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${UNITS_SHEET}!A${rowIdx}:P${rowIdx}`,
      valueInputOption: "RAW",
      requestBody: { values: [objToRow(unit, COLS)] },
    });

    await addLog(sheets, "RETURNED", id,
      `${unit.Product} returned from ${unit.Company} on ${unit.ActualReturn}`, "");

    res.json({ success: true });
  } catch (err) {
    console.error("PATCH /return:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE a unit
app.delete("/api/units/:id", async (req, res) => {
  try {
    const sheets  = await getSheets();
    const { id }  = req.params;
    const rowIdx  = await findRowIndex(sheets, id);
    if (rowIdx === -1) return res.status(404).json({ error: "Unit not found" });

    // Read for log before deleting
    const rowRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${UNITS_SHEET}!A${rowIdx}:P${rowIdx}`,
    });
    const row  = rowRes.data.values[0] || [];
    const unit = {};
    COLS.forEach((c, i) => { unit[c] = row[i] || ""; });

    // Get sheet gid for the units tab
    const metaRes = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    const tabMeta = metaRes.data.sheets.find(s => s.properties.title === UNITS_SHEET);
    if (!tabMeta) return res.status(500).json({ error: "Sheet tab not found" });

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId:    tabMeta.properties.sheetId,
              dimension:  "ROWS",
              startIndex: rowIdx - 1,
              endIndex:   rowIdx,
            },
          },
        }],
      },
    });

    await addLog(sheets, "DELETE", id,
      `Deleted: ${unit.Product} from ${unit.Company}`, "");

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/units:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Serve frontend for any non-API route
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Panache Demo Tracker running on port ${PORT}`);
  console.log(`   Sheet ID: ${SHEET_ID || "⚠️  NOT SET — set GOOGLE_SHEET_ID in .env"}`);
});
