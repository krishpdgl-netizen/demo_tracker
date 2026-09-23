const { allowCors, scriptGet } = require("./_helper");

module.exports = async (req, res) => {
  allowCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  try {
    const data = await scriptGet({ action: "getLogs" });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
