const { allowCors, scriptGet, scriptPost } = require("./_helper");

module.exports = async (req, res) => {
  allowCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method === "GET") {
      const data = await scriptGet({ action: "getAll" });
      return res.json(data);
    }

    if (req.method === "POST") {
      const data = await scriptPost({ action: "add", data: req.body });
      return res.json(data);
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
