const express = require("express");
const { ObjectId } = require("mongodb");
const router = express.Router();

module.exports = (teachersCollection) => {
  router.get("/", async (req, res) => {
    const result = await teachersCollection.find().toArray();
    res.send(result);
  });

  router.get("/by-id/:id", async (req, res) => {
    const teacherId = req.params.id;
    const query = { _id: new ObjectId(teacherId) };
    const result = await teachersCollection.findOne(query);
    if (result) {
      res.send(result);
    } else {
      res.status(404).send({ message: "Teacher not found" });
    }
  });
  router.get("/by-status/:status", async (req, res) => {
    const status = req.params.status;
    const query = { status };
    const result = await teachersCollection.find(query).toArray();
    if (result) {
      res.send(result);
    } else {
      res.status(404).send({ message: "Teachers not found" });
    }
  });
  router.get("/pending-rejected", async (req, res) => {
    try {
      const query = { status: { $in: ["pending", "rejected"] } };
      const result = await teachersCollection.find(query).toArray();

      if (result.length > 0) {
        res.send(result);
      } else {
        res.status(404).send({
          message: "No teachers found with pending or rejected status",
        });
      }
    } catch (error) {
      console.error("Error fetching teachers:", error);
      res.status(500).send({ message: "Internal Server Error" });
    }
  });

  router.post("/", async (req, res) => {
    const newTeacher = req.body;
    const result = await teachersCollection.insertOne(newTeacher);
    res.send(result);
  });

  router.delete("/:id", async (req, res) => {
    const teacherId = req.params.id;
    const query = { _id: new ObjectId(teacherId) };

    const result = await teachersCollection.deleteOne(query);
    res.send(result);
  });
  router.patch("/:id", async (req, res) => {
    const teacherId = req.params.id;
    const query = { _id: new ObjectId(teacherId) };
    const { status } = req.body;
    const updatedDoc = {
      $set: { status },
    };
    const result = await teachersCollection.updateOne(query, updatedDoc);
    res.send(result);
  });

  // Update Teacher
  router.put("/:id", async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const TeacherData = req.body;
    const updatedDoc = {
      $set: { ...TeacherData },
    };
    const result = await teachersCollection.updateOne(query, updatedDoc, {
      upsert: true,
    });
    res.send(result);
  });

  return router;
};
