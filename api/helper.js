// Shared helper — called by every /api/* function
// Proxies requests to the Apps Script Web App

const SCRIPT_URL = process.env.APPS_SCRIPT_URL;

function allowCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function scriptGet(params = {}) {
  if (!SCRIPT_URL) throw new Error("APPS_SCRIPT_URL not set");
  const url = new URL(SCRIPT_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { redirect: "follow" });
  if (!res.ok) throw new Error(`Apps Script ${res.status}`);
  return res.json();
}

async function scriptPost(body) {
  if (!SCRIPT_URL) throw new Error("APPS_SCRIPT_URL not set");
  const res = await fetch(SCRIPT_URL, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Apps Script ${res.status}`);
  return res.json();
}

module.exports = { allowCors, scriptGet, scriptPost };
