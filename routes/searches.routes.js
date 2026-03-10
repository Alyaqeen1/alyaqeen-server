// routes/searches.routes.js
const express = require("express");

module.exports = (searchesCollection) => {
  const router = express.Router();

  // GET /searches - Get all searchable items (maybe for admin)
  router.get("/", async (req, res) => {
    try {
      const result = await searchesCollection.find().toArray();
      res.send(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /searches/public?q=query - MAIN SITE SEARCH
  router.get("/public", async (req, res) => {
    try {
      const { q: query } = req.query;

      // Return empty if query is too short
      if (!query || query.length < 2) {
        return res.json([]);
      }

      // Simple text search across multiple fields
      const results = await searchesCollection
        .find({
          $and: [
            {
              $or: [
                { title: { $regex: query, $options: "i" } },
                { content: { $regex: query, $options: "i" } },
                { excerpt: { $regex: query, $options: "i" } },
                { tags: { $regex: query, $options: "i" } },
              ],
            },
            { visibility: "public" }, // Only show public content
          ],
        })
        .sort({ priority: -1 }) // Higher priority first
        .limit(10)
        .project({
          title: 1,
          url: 1,
          excerpt: 1,
          type: 1,
          priority: 1,
        })
        .toArray();

      res.json(results);
    } catch (error) {
      console.error("Search error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /searches/rebuild - Admin only (we'll add later)
  // GET /searches/dashboard - For dashboard (we'll add later)

  return router;
};
