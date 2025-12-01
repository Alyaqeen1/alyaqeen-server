const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const sendAnnouncementEmail = require("../config/sendAnnouncementEmail");

module.exports = (
  announcementsCollection,
  familiesCollection,
  teachersCollection
) => {
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
  // Get most recently created or updated public announcement
  router.get("/public/latest", async (req, res) => {
    try {
      const result = await announcementsCollection
        .find({ type: "public" })
        .sort({
          updatedAt: -1, // First sort by last update
          createdAt: -1, // Then by creation date
        })
        .limit(1)
        .toArray();

      // Check if result exists and has at least one item
      if (result && result.length > 0) {
        res.send(result[0]);
      } else {
        res.send({}); // Send empty object when no public announcements found
      }
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });
  // Get announcement by type (teacher, parent, public) - returns single for teacher/parent
  router.get("/by-type/:type", async (req, res) => {
    try {
      const type = req.params.type;

      // For teacher and parent → return a single announcement
      if (type === "teacher" || type === "parent") {
        const result = await announcementsCollection.findOne({ type });
        return res.send(result || null);
      }

      // For public → return all sorted by earliest date (createdAt or updatedAt)
      const result = await announcementsCollection
        .find({ type })
        .sort({
          // Sort by whichever field is earlier
          createdAt: 1,
          updatedAt: 1,
        })
        .toArray();

      res.send(result);
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

  // Send announcement to parents (families with >1 child)
  router.post("/send-to-parents/:id", async (req, res) => {
    try {
      const announcement = await announcementsCollection.findOne({
        _id: new ObjectId(req.params.id),
      });

      if (!announcement) {
        return res.status(404).send({ error: "Announcement not found" });
      }

      // Fetch families with more than 1 child
      const families = await familiesCollection
        .find({ "children.1": { $exists: true } }) // checks if second child exists
        .toArray();

      families.forEach((family) => {
        sendAnnouncementEmail({
          to: family?.email,
          name: family?.name,
          title: announcement.title,
          content: announcement.content,
        });
      });

      res.send({ message: "Emails sent to eligible families" });
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });

  // Send announcement to teachers (active & approved)
  router.post("/send-to-teachers/:id", async (req, res) => {
    try {
      const announcement = await announcementsCollection.findOne({
        _id: new ObjectId(req.params.id),
      });

      if (!announcement) {
        return res.status(404).send({ error: "Announcement not found" });
      }

      // Fetch teachers who are active and approved
      const teachers = await teachersCollection
        .find({ activity: "active", status: "approved" })
        .toArray();

      teachers.forEach((teacher) => {
        sendAnnouncementEmail({
          to: teacher.email,
          name: teacher.name,
          title: announcement.title,
          content: announcement.content,
        });
      });

      res.send({ message: "Emails sent to eligible teachers" });
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
  });

  return router;
};
