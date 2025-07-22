const express = require("express");
const router = express.Router();

module.exports = (notificationsLogCollections) => {
  router.get("/", async (req, res) => {
    const result = await notificationsLogCollections.find().toArray();
    res.send(result);
  });

  router.post("/", async (req, res) => {
    const newLog = {
      ...req.body,
      createdAt: new Date(), // Ensure this is a real Date
    };
    const result = await notificationsLogCollections.insertOne(newLog);
    res.send(result);
  });

  return router;
};
