const express = require("express");
const { ObjectId } = require("mongodb");
const router = express.Router();

module.exports = (departmentCollection) => {
  router.get("/", async (req, res) => {
    const result = await departmentCollection.find().toArray();
    res.send(result);
  });
  router.get("/:id", async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await departmentCollection.findOne(query);
    res.send(result);
  });

  router.post("/", async (req, res) => {
    const newDept = req.body;
    const result = await departmentCollection.insertOne(newDept);
    res.send(result);
  });
  router.delete("/:id", async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await departmentCollection.deleteOne(query);
    res.send(result);
  });
  router.put("/:id", async (req, res) => {
    const id = req.params.id;
    const departmentData = req.body;
    const query = { _id: new ObjectId(id) };
    const updatedDoc = {
      $set: { ...departmentData },
    };
    const result = await departmentCollection.updateOne(query, updatedDoc);
    res.send(result);
  });

  return router;
};
