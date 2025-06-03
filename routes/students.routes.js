const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");

// Accept the studentsCollection via parameter
module.exports = (studentsCollection, verifyToken) => {
  // Get all students
  router.get("/", verifyToken, async (req, res) => {
    const result = await studentsCollection.find().toArray();
    res.send(result);
  });

  // Get single student
  router.get("/:id", verifyToken, async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const student = await studentsCollection.findOne(query);
    res.send(student);
  });

  // Create new student
  router.post("/", async (req, res) => {
    const newStudent = req.body;
    const result = await studentsCollection.insertOne(newStudent);
    res.send(result);
  });

  // Update student
  router.put("/:id", async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const studentData = req.body;
    const updatedDoc = {
      $set: { ...studentData },
    };
    const result = await studentsCollection.updateOne(query, updatedDoc);
    res.send(result);
  });

  // Update student status
  router.patch("/:id", async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const { status } = req.body;
    const updatedDoc = { $set: { status } };

    try {
      const result = await studentsCollection.updateOne(query, updatedDoc);
      res.send(result);
    } catch (error) {
      res.status(500).send({ error: "Failed to update student status." });
    }
  });

  // Delete student
  router.delete("/:id", async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await studentsCollection.deleteOne(query);
    res.send(result);
  });

  return router;
};
