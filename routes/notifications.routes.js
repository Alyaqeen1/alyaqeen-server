const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");

module.exports = (notificationsCollection, verifyToken) => {
  router.post("/", async (req, res) => {
    const notification = req.body;
    const result = await notificationsCollection.insertOne(notification);
    res.send(result);
  });

  router.get("/", verifyToken, async (req, res) => {
    const result = await notificationsCollection.find().toArray();
    res.send(result);
  });

  router.get("/unread", verifyToken, async (req, res) => {
    try {
      const result = await notificationsCollection
        .find({ isRead: false })
        .toArray();
      res.send(result);
    } catch (error) {
      res.status(500).send({ success: false, message: "Server error" });
    }
  });

  router.patch("/:id", async (req, res) => {
    const id = req.params.id;
    const result = await notificationsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { isRead: true } }
    );
    res.send(result);
  });

  return router;
};
