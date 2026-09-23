const { allowCors } = require("./_helper");

const GEMINI_KEY = process.env.GEMINI_API_KEY;

module.exports = async (req, res) => {
  allowCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  if (!GEMINI_KEY) {
    return res.status(500).json({
      error: "GEMINI_API_KEY not set"
    });
  }

  const { base64, mimeType } = req.body || {};

  if (!base64 || !mimeType) {
    return res.status(400).json({
      error: "Missing base64 or mimeType"
    });
  }

  const isImage = mimeType.startsWith("image/");
  const isPdf = mimeType === "application/pdf";

  if (!isImage && !isPdf) {
    return res.status(400).json({
      error: "Only image or PDF supported"
    });
  }

  const prompt = `
You are parsing a Panache DigiLife internal dispatch / delivery challan.

Your job is to extract ALL products/items listed on the challan.

IMPORTANT:
- Do NOT extract only the first product.
- Extract every product line visible in the document.
- Extract the quantity for each product.
- Keep each product separate.
- If the same product appears multiple times with different serial numbers, keep them as separate product entries when the serial numbers are individually listed.

Return ONLY valid JSON.
Do not use markdown.
Do not include explanations.

Return exactly this structure:

{
  "products": [
    {
      "Product": "",
      "Serial": "",
      "Quantity": 1
    }
  ],
  "Company": "",
  "Contact": "",
  "Phone": "",
  "Email": "",
  "SentBy": "",
  "DateSent": "",
  "ExpectedReturn": "",
  "Purpose": "",
  "Courier": "",
  "Notes": ""
}

Extraction rules:

1. PRODUCTS
- Extract EVERY distinct product/item line from the challan.
- Do not stop after the first product.
- Product should contain the product/item name.
- Serial should contain the serial number, model number, part number, or equivalent identifier when present.
- Quantity must be a positive integer.
- If quantity is not explicitly mentioned, use 1.
- Do not combine different products into one product.
- If identical products have different serial numbers and each serial is listed, create separate entries.

2. COMPANY
- Extract the recipient/customer/company name.

3. CONTACT
- Extract the contact person's name if available.

4. PHONE
- Extract phone/mobile number if available.

5. EMAIL
- Extract email address if available.

6. SENTBY
- Extract the person/company sending the products if available.

7. DATES
- DateSent should be the dispatch/sent date.
- ExpectedReturn should be the expected return date if present.
- Convert dates to YYYY-MM-DD whenever possible.

8. PURPOSE
- Extract the stated purpose/reason for sending the product.

9. COURIER
- Extract courier/logistics/shipping information if present.

10. NOTES
- Put useful additional information here.
- Do not duplicate the main fields unnecessarily.

11. MISSING DATA
- If a field cannot be found, return an empty string.
- If no products can be identified, return:
  "products": []

12. QUANTITY
- Quantity must always be an integer >= 1.
- If the document says something such as "Qty: 5", return 5.
- If quantity is absent, return 1.
`;

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt
                },
                {
                  inlineData: {
                    mimeType: mimeType,
                    data: base64
                  }
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 2048
          }
        })
      }
    );

    if (!geminiRes.ok) {
      const err = await geminiRes.text();

      return res.status(500).json({
        error: `Gemini error: ${err}`
      });
    }

    const geminiData = await geminiRes.json();

    const rawText =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!rawText) {
      return res.status(500).json({
        error: "Gemini returned an empty response."
      });
    }

    // Remove markdown code fences if Gemini adds them.
    const cleaned = rawText
      .replace(/```json/gi, "")
      .replace(/```/gi, "")
      .trim();

    let parsed;

    try {
      parsed = JSON.parse(cleaned);
    } catch (parseError) {
      return res.status(500).json({
        error: "Gemini returned unexpected format.",
        raw: rawText
      });
    }

    // Make sure products is always an array.
    if (!Array.isArray(parsed.products)) {
      parsed.products = [];
    }

    // Normalize every product.
    parsed.products = parsed.products
      .map((p) => {
        const quantityRaw =
          p.Quantity ??
          p.quantity ??
          p.Qty ??
          p.qty ??
          1;

        let quantity = Number(quantityRaw);

        if (!Number.isFinite(quantity) || quantity < 1) {
          quantity = 1;
        }

        quantity = Math.floor(quantity);

        return {
          Product: String(
            p.Product ??
            p.product ??
            p.Name ??
            p.name ??
            ""
          ).trim(),

          Serial: String(
            p.Serial ??
            p.serial ??
            p.Model ??
            p.model ??
            p.PartNumber ??
            p.partNumber ??
            ""
          ).trim(),

          Quantity: quantity
        };
      })
      .filter((p) => p.Product || p.Serial);

    // Keep legacy fields for compatibility with the existing frontend/backend.
    const firstProduct = parsed.products[0] || {};

    parsed.Product = firstProduct.Product || "";
    parsed.Serial = firstProduct.Serial || "";
    parsed.Quantity = firstProduct.Quantity || 1;

    // Normalize common fields.
    parsed.Company = String(parsed.Company || "").trim();
    parsed.Contact = String(parsed.Contact || "").trim();
    parsed.Phone = String(parsed.Phone || "").trim();
    parsed.Email = String(parsed.Email || "").trim();
    parsed.SentBy = String(parsed.SentBy || "").trim();
    parsed.DateSent = String(parsed.DateSent || "").trim();
    parsed.ExpectedReturn = String(parsed.ExpectedReturn || "").trim();
    parsed.Purpose = String(parsed.Purpose || "").trim();
    parsed.Courier = String(parsed.Courier || "").trim();
    parsed.Notes = String(parsed.Notes || "").trim();

    return res.json({
      success: true,
      fields: parsed
    });

  } catch (e) {
    console.error("SCAN ERROR:", e);

    return res.status(500).json({
      error: e.message || "Scan failed"
    });
  }
};
