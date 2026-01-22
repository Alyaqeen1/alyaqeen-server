const express = require("express");
const { ObjectId } = require("mongodb");
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

  // DELETE complaint by ID
  router.delete("/:id", async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await complaintsCollection.deleteOne(query);
    res.send(result);
  });
  return router;
};
