const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const sendApprovalEmail = require("../config/sendApprovalEmail");

// Accept the studentsCollection via parameter
module.exports = (
  studentsCollection,
  verifyToken,
  familiesCollection,
  groupsCollection
) => {
  // 🔁 Reusable aggregation pipeline function
  const buildStudentAggregationPipeline = (match = {}) => [
    { $match: match },
    {
      $addFields: {
        deptObjectId: {
          $cond: [
            { $ne: ["$academic.dept_id", null] },
            { $toObjectId: "$academic.dept_id" },
            null,
          ],
        },
        classObjectId: {
          $cond: [
            { $ne: ["$academic.class_id", null] },
            { $toObjectId: "$academic.class_id" },
            null,
          ],
        },
      },
    },
    {
      $lookup: {
        from: "departments",
        localField: "deptObjectId",
        foreignField: "_id",
        as: "departmentInfo",
      },
    },
    {
      $lookup: {
        from: "classes",
        localField: "classObjectId",
        foreignField: "_id",
        as: "classInfo",
      },
    },
    {
      $addFields: {
        "academic.department": {
          $arrayElemAt: ["$departmentInfo.dept_name", 0],
        },
        "academic.class": {
          $arrayElemAt: ["$classInfo.class_name", 0],
        },
      },
    },
    {
      $project: {
        departmentInfo: 0,
        classInfo: 0,
        deptObjectId: 0,
        classObjectId: 0,
      },
    },
  ];

  // 🔹 GET: All students with department/class names
  router.get("/", async (req, res) => {
    try {
      const result = await studentsCollection
        .aggregate(buildStudentAggregationPipeline())
        .toArray();
      res.send(result);
    } catch (error) {
      console.error("Error fetching all students:", error);
      res.status(500).send({ error: "Failed to fetch students" });
    }
  });

  // 🔹 GET: Students without enrolled or hold status
  router.get("/without-enrolled", verifyToken, async (req, res) => {
    try {
      const result = await studentsCollection
        .aggregate(
          buildStudentAggregationPipeline({
            status: { $nin: ["enrolled", "hold"] },
          })
        )
        .toArray();
      res.send(result);
    } catch (error) {
      console.error("Error fetching students without enrolled:", error);
      res.status(500).send({ error: "Failed to fetch students" });
    }
  });

  // 🔹 GET: Students by specific status
  router.get("/get-by-status/:status", verifyToken, async (req, res) => {
    const status = req.params.status;
    try {
      const result = await studentsCollection
        .aggregate(buildStudentAggregationPipeline({ status }))
        .toArray();
      res.send(result);
    } catch (error) {
      console.error("Error fetching students by status:", error);
      res.status(500).send({ error: "Failed to fetch students" });
    }
  });

  // 🔹 GET: Single student by ID (with department/class info)
  router.get("/by-id/:id", verifyToken, async (req, res) => {
    const id = req.params.id;
    try {
      const student = await studentsCollection
        .aggregate(buildStudentAggregationPipeline({ _id: new ObjectId(id) }))
        .toArray();

      if (!student.length) {
        return res.status(404).send({ message: "Student not found" });
      }

      res.send(student[0]);
    } catch (error) {
      console.error("Error fetching single student:", error);
      res.status(500).send({ error: "Failed to fetch student" });
    }
  });

  router.get("/by-group/:groupId", async (req, res) => {
    try {
      const groupId = req.params.groupId;
      const group = await groupsCollection.findOne({
        _id: new ObjectId(groupId),
      });

      if (!group) return res.status(404).send({ message: "Group not found" });

      const pipeline = [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: [{ $toString: "$academic.dept_id" }, group.dept_id] },
                { $eq: [{ $toString: "$academic.class_id" }, group.class_id] },
                { $eq: ["$academic.session", group.session] },
                { $eq: ["$academic.time", group.time] },
                { $eq: ["$status", "approved"] },
              ],
            },
          },
        },
        ...buildStudentAggregationPipeline(), // no extra $match needed here
      ];

      const students = await studentsCollection.aggregate(pipeline).toArray();
      res.send(students);
    } catch (error) {
      console.error("Error fetching students by group:", error);
      res.status(500).send({ error: "Internal Server Error" });
    }
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
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!status) {
        return res.status(400).json({ error: "Status is required" });
      }

      const result = await studentsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
      );
      // 2. Fetch the updated student
      const student = await studentsCollection.findOne({
        _id: new ObjectId(id),
      });

      // 3. If approved, send email
      if (status === "approved") {
        await sendApprovalEmail({
          to: student?.email,
          name: student?.family_name,
          studentName: student?.name,
        });
      }

      res.json(result);
    } catch (error) {
      console.error("PATCH /students/:id failed:", error);
      res.status(500).json({ error: "Internal Server Error" });
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
