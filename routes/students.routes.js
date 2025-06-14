const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const sendApprovalEmail = require("../config/sendApprovalEmail");

// Accept the studentsCollection via parameter
module.exports = (studentsCollection, verifyToken, familiesCollection) => {
  // Get all students
  router.get("/", verifyToken, async (req, res) => {
    const result = await studentsCollection.find().toArray();
    res.send(result);
  });
  // ✅ 2. Get students excluding 'enrolled' and 'hold' statuses
  router.get("/without-enrolled", verifyToken, async (req, res) => {
    try {
      const result = await studentsCollection
        .find({ status: { $nin: ["enrolled", "hold"] } })
        .toArray();
      res.send(result);
    } catch (error) {
      console.error("Error fetching filtered students:", error);
      res.status(500).send({ error: "Failed to fetch students." });
    }
  });
  router.get("/get-by-status/:status", verifyToken, async (req, res) => {
    const status = req.params.status;
    const query = { status };
    const result = await studentsCollection.find(query).toArray();
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

    try {
      // If not found, insert new student
      const result = await studentsCollection.insertOne(newStudent);
      res.status(201).send(result);
    } catch (error) {
      console.error(error);
      res.status(500).send({ message: "Internal Server Error" });
    }
  });

  // Update student
  router.put("/:id", async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const studentData = req.body;
    const updatedDoc = {
      $set: { ...studentData },
    };
    const result = await studentsCollection.updateOne(query, updatedDoc, {
      upsert: true,
    });
    res.send(result);
  });

  // Update student status
  router.patch("/:id", async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const { status } = req.body;

    const updatedDoc = { $set: { status } };

    try {
      // First, fetch the student data
      const student = await studentsCollection.findOne(query);

      if (!student) {
        return res.status(404).send({ error: "Student not found." });
      }

      // Proceed to update the status
      const result = await studentsCollection.updateOne(query, updatedDoc);

      // ✅ If status is being changed to "approved", trigger the email
      if (status === "approved") {
        await sendApprovalEmail({
          to: student.email, // adjust based on your schema
          name: student?.father?.name, // parent's name
          studentName: student.name, // student's name
        });
      }

      res.send(result);
    } catch (error) {
      console.error("Error updating status:", error);
      res.status(500).send({ error: "Failed to update student status." });
    }
  });

  // Delete student
  // DELETE /students/:id
  router.delete("/:id", async (req, res) => {
    const id = req.params.id;

    // 1. Find the student first to get UID
    const student = await studentsCollection.findOne({ _id: new ObjectId(id) });

    if (!student) {
      return res.status(404).send({ message: "Student not found" });
    }

    const studentUid = student.uid;

    // 2. Delete the student
    const result = await studentsCollection.deleteOne({
      _id: new ObjectId(id),
    });

    // 3. Remove student UID from family (but don't delete the family)
    await familiesCollection.updateOne(
      { children: studentUid },
      { $pull: { children: studentUid } }
    );

    res.send({
      message: "Student deleted and removed from family successfully",
    });
  });

  return router;
};
