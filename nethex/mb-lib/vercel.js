// Vercel adapter: wraps a lib core (params -> { status, body }) into a Vercel
// serverless handler. Used by every file in api/.

export function serve(run) {
  return async function handler(req, res) {
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      return res.status(204).end();
    }
    try {
      const { status, body } = await run(req.query || {});
      return res.status(status).json(body);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  };
}
