const express = require("express");
const { ObjectId } = require("mongodb");
const router = express.Router();

module.exports = (classesCollection) => {
  router.get("/", async (req, res) => {
    const result = await classesCollection.find().toArray();
    res.send(result);
  });
  router.get("/:id", async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await classesCollection.findOne(query);
    res.send(result);
  });

  router.post("/", async (req, res) => {
    const newClass = req.body;
    const result = await classesCollection.insertOne(newClass);
    res.send(result);
  });
  router.delete("/:id", async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await classesCollection.deleteOne(query);
    res.send(result);
  });
  router.put("/:id", async (req, res) => {
    const id = req.params.id;
    const classData = req.body;
    const query = { _id: new ObjectId(id) };
    const updatedDoc = {
      $set: { ...classData },
    };
    const result = await classesCollection.updateOne(query, updatedDoc);
    res.send(result);
  });

  return router;
};
