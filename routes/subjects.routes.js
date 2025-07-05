const express = require("express");
const { ObjectId } = require("mongodb");
const router = express.Router();

module.exports = (subjectsCollection) => {
  router.get("/", async (req, res) => {
    const result = await subjectsCollection.find().toArray();
    res.send(result);
  });
  router.get("/:id", async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await subjectsCollection.findOne(query);
    res.send(result);
  });

  router.post("/", async (req, res) => {
    const newSubject = req.body;
    const result = await subjectsCollection.insertOne(newSubject);
    res.send(result);
  });
  router.delete("/:id", async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await subjectsCollection.deleteOne(query);
    res.send(result);
  });
  router.put("/:id", async (req, res) => {
    const id = req.params.id;
    const subjectData = req.body;
    const query = { _id: new ObjectId(id) };
    const updatedDoc = {
      $set: { ...subjectData },
    };
    const result = await subjectsCollection.updateOne(query, updatedDoc);
    res.send(result);
  });

  return router;
};
