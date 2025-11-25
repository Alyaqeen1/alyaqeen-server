const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");

module.exports = (announcementsCollection) => {
  // Get all announcements or filter by type
  router.get("/", async (req, res) => {
    try {
      const { type } = req.query;
      const query = type ? { type } : {};
      const result = await announcementsCollection.find(query).toArray();
      res.send(result);
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });

  // Get announcement by type (teacher, parent, public) - returns single for teacher/parent
  router.get("/by-type/:type", async (req, res) => {
    try {
      const type = req.params.type;
      // For teacher and parent, return the single announcement
      if (type === "teacher" || type === "parent") {
        const result = await announcementsCollection.findOne({ type });
        res.send(result || null);
      } else {
        // For public, return all public announcements
        const result = await announcementsCollection.find({ type }).toArray();
        res.send(result);
      }
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });

  // Create or update announcement
  router.post("/", async (req, res) => {
    try {
      const { type, content, lastUpdated, title } = req.body;

      // For teacher and parent types, update existing or create new single announcement
      if (type === "teacher" || type === "parent") {
        const existingAnnouncement = await announcementsCollection.findOne({
          type,
        });

        let result;
        if (existingAnnouncement) {
          // Update existing announcement
          result = await announcementsCollection.updateOne(
            { type },
            { $set: { content, lastUpdated, updatedAt: new Date() } }
          );
        } else {
          // Create new announcement
          result = await announcementsCollection.insertOne({
            type,
            content,
            lastUpdated,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
        res.send(result);
      } else {
        // For public type, always create new announcement
        const result = await announcementsCollection.insertOne({
          type,
          title,
          content,
          lastUpdated,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        res.send(result);
      }
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });

  // Update specific announcement by ID (for public announcements)
  router.put("/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const { type, title, content, lastUpdated } = req.body;

      const result = await announcementsCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            type,
            title,
            content,
            lastUpdated,
            updatedAt: new Date(),
          },
        }
      );

      res.send(result);
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });

  // Delete specific announcement by ID
  router.delete("/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const result = await announcementsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });

  // Get specific announcement by ID
  router.get("/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await announcementsCollection.findOne(query);
      res.send(result);
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });

  return router;
};
