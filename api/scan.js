const { allowCors } = require("./_helper");

const GEMINI_KEY = process.env.GEMINI_API_KEY;

// Vercel parses multipart automatically when you export config
// We receive the raw body and handle it manually using built-in formidable support
// But the simplest reliable approach on Vercel: accept base64 JSON from the frontend directly

module.exports = async (req, res) => {
  allowCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!GEMINI_KEY) return res.status(500).json({ error: "GEMINI_API_KEY not set" });

  const { base64, mimeType } = req.body;
  if (!base64 || !mimeType) return res.status(400).json({ error: "Missing base64 or mimeType" });

  const isImage = mimeType.startsWith("image/");
  const isPdf   = mimeType === "application/pdf";
  if (!isImage && !isPdf) return res.status(400).json({ error: "Only image or PDF supported" });

  const prompt = `You are parsing a Panache DigiLife internal dispatch / delivery challan.
Extract every field you can find and return ONLY valid JSON — no markdown, no explanation.

Return this exact structure (use empty string "" for any field not found):
{
  "Product":        "",
  "Serial":         "",
  "Company":        "",
  "Contact":        "",
  "Phone":          "",
  "Email":          "",
  "SentBy":         "",
  "DateSent":       "",
  "ExpectedReturn": "",
  "Purpose":        "",
  "Courier":        "",
  "Notes":          ""
}

DateSent and ExpectedReturn must be in YYYY-MM-DD format.`;

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inlineData: { mimeType, data: base64 } }
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
    const cleaned = rawText.replace(/```json|```/gi, "").trim();

    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch { return res.status(500).json({ error: "Gemini returned unexpected format.", raw: rawText }); }

    res.json({ success: true, fields: parsed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
