const express = require("express");
const router = express.Router();

module.exports = (usersCollection) => {
  router.get("/", async (req, res) => {
    const result = await usersCollection.find().toArray();
    res.send(result);
  });

  router.get("/role/:email", async (req, res) => {
    const email = req.params.email;
    const query = { email };
    const result = await usersCollection.findOne(query);
    res.send({ role: result?.role });
  });
  router.get("/by-email/:email", async (req, res) => {
    const email = req.params.email;
    const query = { email };
    const result = await usersCollection.findOne(query);
    res.send(result);
  });

  router.post("/", async (req, res) => {
    const newUser = req.body;
    const result = await usersCollection.insertOne(newUser);
    res.send(result);
  });

  return router;
};
