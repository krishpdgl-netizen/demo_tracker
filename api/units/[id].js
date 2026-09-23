const { allowCors, scriptPost } = require("../_helper");

module.exports = async (req, res) => {
  allowCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { id } = req.query;

  try {
    // PUT /api/units/:id  — update
    if (req.method === "PUT") {
      const data = await scriptPost({ action: "update", id, data: req.body });
      return res.json(data);
    }

    // PATCH /api/units/:id/return  — mark returned
    // Vercel doesn't support nested dynamic routes easily,
    // so we use ?action=return on the same [id] route
    if (req.method === "PATCH") {
      const { date, notes } = req.body;
      const data = await scriptPost({ action: "markReturned", id, date, notes });
      return res.json(data);
    }

    // DELETE /api/units/:id
    if (req.method === "DELETE") {
      const data = await scriptPost({ action: "delete", id });
      return res.json(data);
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
