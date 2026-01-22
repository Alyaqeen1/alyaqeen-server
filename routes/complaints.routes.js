const express = require("express");
const router = express.Router();

module.exports = (complaintsCollection) => {
  router.get("/", async (req, res) => {
    const result = await complaintsCollection.find().toArray();
    res.send(result);
  });

  router.post("/", async (req, res) => {
    const newComplaint = {
      ...req.body,
      createdAt: new Date(), // ✅ add timestamp
    };

    const result = await complaintsCollection.insertOne(newComplaint);
    res.send(result);
  });

  return router;
};
