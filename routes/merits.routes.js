const express = require("express");
const router = express.Router();

module.exports = (meritsCollection) => {
  router.get("/", async (req, res) => {
    const result = await meritsCollection.find().toArray();
    res.send(result);
  });

  router.post("/", async (req, res) => {
    const newMerit = req.body;
    const result = await meritsCollection.insertOne(newMerit);
    res.send(result);
  });

  return router;
};
