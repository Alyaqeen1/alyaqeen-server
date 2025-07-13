const express = require("express");
const { ObjectId } = require("mongodb");
const router = express.Router();

module.exports = (
  teachersCollection,
  departmentsCollection,
  classesCollection,
  subjectsCollection
) => {
  router.get("/", async (req, res) => {
    const result = await teachersCollection.find().toArray();
    res.send(result);
  });

  router.get("/by-id/:id", async (req, res) => {
    const teacherId = req.params.id;
    if (!ObjectId.isValid(teacherId)) {
      return res.status(400).send({ message: "Invalid teacher ID format" });
    }
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
  router.get("/by-email/:email", async (req, res) => {
    const email = req.params.email;
    const query = { email };
    const result = await teachersCollection.findOne(query);
    if (result) {
      res.send(result);
    } else {
      res.status(404).send({ message: "Teachers not found" });
    }
  });
  router.get("/by-activity/:activity", async (req, res) => {
    const activity = req.params.activity;

    const query = {
      activity: activity,
      status: "approved", // Only approved teachers
    };

    try {
      const result = await teachersCollection.find(query).toArray();

      if (result.length > 0) {
        res.send(result);
      } else {
        res
          .status(200)
          .send({ message: "No approved teachers found for this activity" });
      }
    } catch (error) {
      console.error("Error fetching teachers by activity:", error);
      res.status(500).send({ message: "Internal server error" });
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
    if (!ObjectId.isValid(teacherId)) {
      return res.status(400).send({ message: "Invalid teacher ID format" });
    }
    const query = { _id: new ObjectId(teacherId) };

    const result = await teachersCollection.deleteOne(query);
    res.send(result);
  });
  router.patch("/update-status/:id", async (req, res) => {
    const teacherId = req.params.id;
    if (!ObjectId.isValid(teacherId)) {
      return res.status(400).send({ message: "Invalid teacher ID format" });
    }
    const query = { _id: new ObjectId(teacherId) };
    const { status } = req.body;
    const updatedDoc = {
      $set: { status },
    };
    const result = await teachersCollection.updateOne(query, updatedDoc);
    res.send(result);
  });
  // update activity
  router.patch("/update-activity/:id", async (req, res) => {
    const teacherId = req.params.id;
    if (!ObjectId.isValid(teacherId)) {
      return res.status(400).send({ message: "Invalid teacher ID format" });
    }
    const query = { _id: new ObjectId(teacherId) };
    const { activity } = req.body;
    const updatedDoc = {
      $set: { activity },
    };
    const result = await teachersCollection.updateOne(query, updatedDoc);
    res.send(result);
  });

  // Update Teacher
  router.put("/:id", async (req, res) => {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid teacher ID format" });
    }
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

  router.get("/with-details/:id", async (req, res) => {
    const teacherId = new ObjectId(req.params.id);
    if (!ObjectId.isValid(teacherId)) {
      return res.status(400).send({ message: "Invalid teacher ID format" });
    }
    try {
      const result = await teachersCollection
        .aggregate([
          { $match: { _id: teacherId } },

          // Convert string IDs to ObjectIds for lookup
          {
            $addFields: {
              dept_ids: {
                $map: {
                  input: "$dept_ids",
                  as: "id",
                  in: { $toObjectId: "$$id" },
                },
              },
              class_ids: {
                $map: {
                  input: "$class_ids",
                  as: "id",
                  in: { $toObjectId: "$$id" },
                },
              },
              subject_ids: {
                $map: {
                  input: "$subject_ids",
                  as: "id",
                  in: { $toObjectId: "$$id" },
                },
              },
            },
          },

          // Join with departments
          {
            $lookup: {
              from: "departments",
              localField: "dept_ids",
              foreignField: "_id",
              as: "departments_info",
            },
          },

          // Join with classes
          {
            $lookup: {
              from: "classes",
              localField: "class_ids",
              foreignField: "_id",
              as: "classes_info",
            },
          },

          // Join with subjects
          {
            $lookup: {
              from: "subjects",
              localField: "subject_ids",
              foreignField: "_id",
              as: "subjects_info",
            },
          },
        ])
        .toArray();

      if (result.length > 0) {
        res.send(result[0]); // Send the single teacher with populated info
      } else {
        res.status(200).send({ message: "Teacher not found" });
      }
    } catch (err) {
      console.error("Aggregation error:", err);
      res.status(500).send({ message: "Server Error" });
    }
  });

  return router;
};
