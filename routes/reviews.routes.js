const express = require("express");
const router = express.Router();

module.exports = (reviewsCollection) => {
  router.get("/", async (req, res) => {
    const result = await reviewsCollection.find().toArray();
    res.send(result);
  });

  router.post("/", async (req, res) => {
    const newReview = req.body;
    const result = await reviewsCollection.insertOne(newReview);
    res.send(result);
  });

  return router;
};
