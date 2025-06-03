const express = require("express");
const router = express.Router();

module.exports = (familiesCollection) => {
  router.get("/", async (req, res) => {
    const result = await familiesCollection.find().toArray();
    res.send(result);
  });

  router.get("/:email", async (req, res) => {
    const email = req.params.email;
    const query = { email };
    const result = await familiesCollection.findOne(query);
    res.send(result);
  });

  router.post("/", async (req, res) => {
    const family = req.body;
    const result = await familiesCollection.insertOne(family);
    res.send(result);
  });

  router.patch("/:email/add-child", async (req, res) => {
    const email = req.params.email;
    const { studentUid } = req.body;

    const result = await familiesCollection.updateOne(
      { email },
      { $addToSet: { children: studentUid } } // prevents duplicates
    );

    res.send(result);
  });

  return router;
};
