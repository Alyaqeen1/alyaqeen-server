const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const sendApprovalEmail = require("../config/sendApprovalEmail");
const buildStudentAggregationPipeline = require("../config/buildStudentAggregationPipeline");

// Accept the studentsCollection via parameter
module.exports = (
  studentsCollection,
  verifyToken,
  familiesCollection,
  classesCollection,
  groupsCollection,
  countersCollection // Receive the collection
) => {
  async function getNextSequenceValue(sequenceName) {
    try {
      // First try to find and update the counter
      const result = await countersCollection.findOneAndUpdate(
        { _id: sequenceName },
        { $inc: { sequence_value: 1 } },
        {
          returnDocument: "after", // Use this for newer drivers
          upsert: true,
        }
      );

      // Handle different response formats based on driver version
      if (result && result.value) {
        // Newer driver versions (4.x+)
        return result.value.sequence_value;
      } else if (result && result.sequence_value !== undefined) {
        // Some versions might return the document directly
        return result.sequence_value;
      } else if (
        result &&
        result.lastErrorObject &&
        result.lastErrorObject.updatedExisting
      ) {
        // For older drivers (3.x), we need to fetch the current value
        const currentCounter = await countersCollection.findOne({
          _id: sequenceName,
        });
        return currentCounter.sequence_value;
      } else {
        // If all else fails, manually handle the counter
        const currentCounter = await countersCollection.findOne({
          _id: sequenceName,
        });
        if (!currentCounter) {
          // Create the counter if it doesn't exist
          await countersCollection.insertOne({
            _id: sequenceName,
            sequence_value: 1,
          });
          return 1;
        }
        return currentCounter.sequence_value;
      }
    } catch (error) {
      // Fallback: manually handle the counter operation
      try {
        const currentCounter = await countersCollection.findOne({
          _id: sequenceName,
        });

        if (!currentCounter) {
          // Create counter with initial value 1
          await countersCollection.insertOne({
            _id: sequenceName,
            sequence_value: 1,
          });
          return 1;
        }

        // Increment and update manually
        const newValue = currentCounter.sequence_value + 1;
        await countersCollection.updateOne(
          { _id: sequenceName },
          { $set: { sequence_value: newValue } }
        );

        return newValue;
      } catch (fallbackError) {
        throw new Error(`Failed to get sequence value for ${sequenceName}`);
      }
    }
  }
  // 🔹 GET: All students with department/class names
  router.get("/", async (req, res) => {
    try {
      // First, verify the collection exists
      const collectionExists = await studentsCollection.countDocuments();
      if (collectionExists === 0) {
        return res.status(404).send({ error: "Students collection is empty" });
      }

      // Debug: Log the pipeline before execution
      const pipeline = buildStudentAggregationPipeline();

      // Execute the aggregation with error handling
      const cursor = studentsCollection.aggregate(pipeline);
      const result = await cursor.toArray();

      if (!result || result.length === 0) {
        return res.status(404).send({
          error: "No students found",
          warning: "Pipeline executed successfully but returned no results",
        });
      }

      res.send(result);
    } catch (error) {
      console.error("Aggregation Error:", error);
      res.status(500).send({
        error: "Failed to fetch students",
        details: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  });

  // Get total number of teachers with gender and activity breakdown
  router.get("/count", async (req, res) => {
    try {
      const total = await studentsCollection.countDocuments();

      const maleCount = await studentsCollection.countDocuments({
        gender: "Male",
      });
      const femaleCount = await studentsCollection.countDocuments({
        gender: "Female",
      });

      const activeCount = await studentsCollection.countDocuments({
        status: "enrolled",
        activity: "active",
      });
      const inactiveCount = await studentsCollection.countDocuments({
        activity: "inactive",
      });

      const weekdaysCount = await studentsCollection.countDocuments({
        "academic.session": "weekdays",
      });
      const weekendCount = await studentsCollection.countDocuments({
        "academic.session": "weekend",
      });

      res.send({
        total,
        gender: {
          male: maleCount,
          female: femaleCount,
        },
        activity: {
          active: activeCount,
          inactive: inactiveCount,
        },
        session: {
          weekdays: weekdaysCount,
          weekend: weekendCount,
        },
      });
    } catch (error) {
      res.status(500).send({ message: "Failed to count students", error });
    }
  });

  // 🔹 GET: Students without enrolled or hold status
  router.get("/without-enrolled", async (req, res) => {
    try {
      const result = await studentsCollection
        .aggregate(
          buildStudentAggregationPipeline({
            status: { $nin: ["enrolled", "hold", "rejected"] },
          })
        )
        .toArray();
      res.send(result);
    } catch (error) {
      res.status(500).send({ error: "Failed to fetch students" });
    }
  });

  // 🔹 GET: Students by specific status
  router.get("/get-by-status/:status", async (req, res) => {
    const status = req.params.status;
    try {
      const result = await studentsCollection
        .aggregate(buildStudentAggregationPipeline({ status }))
        .toArray();
      res.send(result);
    } catch (error) {
      res.status(500).send({ error: "Failed to fetch students" });
    }
  });

  // 🔹 GET: Single student by ID (with department/class info)
  router.get("/by-id/:id", async (req, res) => {
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
      res.status(500).send({ error: "Failed to fetch student" });
    }
  });
  // 🔹 GET: Student by email
  router.get("/by-email/:email", async (req, res) => {
    const { email } = req.params;
    try {
      const students = await studentsCollection
        .find({ email }, { projection: { _id: 1, name: 1 } }) // only return _id and name
        .toArray();
      if (!students.length) {
        return res.status(404).send({ message: "Student not found" });
      }

      res.send(students); // send array with only _id & name
    } catch (error) {
      res.status(500).send({ error: "Failed to fetch student by email" });
    }
  });

  // GET /students/by-group/:classId  (classId comes from classes collection)

  router.get("/by-group/:classId", async (req, res) => {
    try {
      const { classId } = req.params;

      // 1️⃣  Sanity‑check the ID
      if (!ObjectId.isValid(classId))
        return res.status(400).send({ message: "Invalid class ID" });

      // 2️⃣  Fetch the class we want to match against
      const cls = await classesCollection.findOne({
        _id: new ObjectId(classId),
      });

      if (!cls) return res.status(404).send({ message: "Class not found" });

      // 3️⃣  Build the aggregation pipeline
      const matchStage = {
        $match: {
          $expr: {
            $and: [
              { $eq: ["$academic.dept_id", cls.dept_id] },
              { $eq: ["$academic.class_id", cls._id.toString()] },
              { $eq: ["$academic.session", cls.session] },
              { $eq: ["$academic.time", cls.session_time] },
              { $in: ["$status", ["enrolled", "hold"]] },
              { $eq: ["$activity", "active"] },
            ],
          },
        },
      };

      const students = await studentsCollection
        .aggregate([matchStage, ...buildStudentAggregationPipeline()])
        .toArray();

      res.send(students);
    } catch (err) {
      res.status(500).send({ error: "Internal Server Error" });
    }
  });

  router.get("/by-activity/:activity", async (req, res) => {
    const activity = req.params.activity;
    const { search } = req.query;
    try {
      const matchCriteria = {
        activity: activity,
        status: { $in: ["enrolled", "hold"] },
      };

      if (search && search.trim() !== "") {
        matchCriteria.name = { $regex: search, $options: "i" };
      }

      const students = await studentsCollection
        .aggregate([
          ...buildStudentAggregationPipeline(matchCriteria),
          {
            $addFields: {
              parsedStartingDate: {
                $cond: {
                  if: {
                    $and: [
                      { $ne: ["$startingDate", null] },
                      { $ne: ["$startingDate", ""] },
                    ],
                  },
                  then: {
                    $dateFromString: {
                      dateString: "$startingDate",
                      format: "%Y-%m-%d",
                    },
                  },
                  else: new Date("9999-12-31"), // far future date so nulls go last
                },
              },
            },
          },
          { $sort: { parsedStartingDate: -1 } },
          { $project: { parsedStartingDate: 0 } },
          {
            $project: {
              _id: 1, // optional if you want to keep the ID,
              uid: 1,
              name: 1,
              email: 1,
              academic: 1,
              monthly_fee: 1,
              status: 1,
              activity: 1,
              startingDate: 1,
              student_id: 1,
            },
          },
        ])
        .toArray();

      res.send(students);
    } catch (error) {
      console.error("Search error:", error);
      res.status(500).send({
        error: "Failed to fetch students",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  });

  // Create new student
  // Create new student
  router.post("/", async (req, res) => {
    const newStudent = req.body;

    try {
      // Get the next sequential student ID
      const studentId = await getNextSequenceValue("studentId");

      // Add the sequential ID to the student data
      newStudent.student_id = studentId;

      // If not found, insert new student
      const result = await studentsCollection.insertOne(newStudent);

      res.status(201).send({
        ...result,
        student_id: studentId, // Include the sequential ID in the response
      });
    } catch (error) {
      console.error("Error creating student:", error);
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

  router.patch("/update-activity/:id", async (req, res) => {
    const studentId = req.params.id;
    if (!ObjectId.isValid(studentId)) {
      return res.status(400).send({ message: "Invalid student ID format" });
    }
    const query = { _id: new ObjectId(studentId) };
    const { activity } = req.body;
    const updatedDoc = {
      $set: { activity },
    };
    const result = await studentsCollection.updateOne(query, updatedDoc);
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

    res.send(result);
  });

  return router;
};
