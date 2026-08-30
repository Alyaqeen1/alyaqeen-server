const express = require("express");
const { ObjectId } = require("mongodb");
const router = express.Router();

module.exports = (yearlyReportsCollection) => {
  // ==================== GET ALL REPORTS ====================
  router.get("/", async (req, res) => {
    try {
      const result = await yearlyReportsCollection
        .aggregate([
          // Convert string IDs to ObjectId
          {
            $addFields: {
              student_id_obj: { $toObjectId: "$student_id" },
              teacher_id_obj: { $toObjectId: "$teacher_id" },
              class_id_obj: { $toObjectId: "$class_id" },
            },
          },
          // Lookup student
          {
            $lookup: {
              from: "students",
              localField: "student_id_obj",
              foreignField: "_id",
              as: "student_info",
            },
          },
          {
            $unwind: {
              path: "$student_info",
              preserveNullAndEmptyArrays: true,
            },
          },
          // Lookup teacher
          {
            $lookup: {
              from: "teachers",
              localField: "teacher_id_obj",
              foreignField: "_id",
              as: "teacher_info",
            },
          },
          {
            $unwind: {
              path: "$teacher_info",
              preserveNullAndEmptyArrays: true,
            },
          },
          // Lookup class
          {
            $lookup: {
              from: "classes",
              localField: "class_id_obj",
              foreignField: "_id",
              as: "class_info",
            },
          },
          {
            $unwind: {
              path: "$class_info",
              preserveNullAndEmptyArrays: true,
            },
          },
          // Add name fields
          {
            $addFields: {
              student_name: "$student_info.name",
              teacher_name: "$teacher_info.name",
              class_name: "$class_info.class_name",
            },
          },
          // Remove temporary fields
          {
            $project: {
              student_id_obj: 0,
              teacher_id_obj: 0,
              class_id_obj: 0,
              student_info: 0,
              teacher_info: 0,
              class_info: 0,
            },
          },
          // Sort by date
          { $sort: { created_at: -1 } },
        ])
        .toArray();

      res.send(result);
    } catch (error) {
      console.error("Error fetching yearly reports:", error);
      res.status(500).send({ error: error.message });
    }
  });

  // ==================== GET STUDENT'S YEARLY REPORTS ====================
  router.get("/student/:studentId", async (req, res) => {
    try {
      const { studentId } = req.params;
      const { academic_year } = req.query;

      const query = { student_id: studentId };
      if (academic_year) {
        query.academic_year = academic_year;
      }

      const result = await yearlyReportsCollection
        .aggregate([
          { $match: query },
          {
            $addFields: {
              student_id_obj: { $toObjectId: "$student_id" },
              teacher_id_obj: { $toObjectId: "$teacher_id" },
              class_id_obj: { $toObjectId: "$class_id" },
            },
          },
          {
            $lookup: {
              from: "students",
              localField: "student_id_obj",
              foreignField: "_id",
              as: "student_info",
            },
          },
          {
            $unwind: {
              path: "$student_info",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $lookup: {
              from: "teachers",
              localField: "teacher_id_obj",
              foreignField: "_id",
              as: "teacher_info",
            },
          },
          {
            $unwind: {
              path: "$teacher_info",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $lookup: {
              from: "classes",
              localField: "class_id_obj",
              foreignField: "_id",
              as: "class_info",
            },
          },
          {
            $unwind: {
              path: "$class_info",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $addFields: {
              student_name: "$student_info.name",
              teacher_name: "$teacher_info.name",
              class_name: "$class_info.class_name",
            },
          },
          {
            $project: {
              student_id_obj: 0,
              teacher_id_obj: 0,
              class_id_obj: 0,
              student_info: 0,
              teacher_info: 0,
              class_info: 0,
            },
          },
        ])
        .toArray();

      res.send(result);
    } catch (error) {
      console.error("Error fetching student reports:", error);
      res.status(500).send({ error: error.message });
    }
  });

  // ==================== GET BEGINNING OF YEAR ====================
  router.get("/student/:studentId/beginning", async (req, res) => {
    try {
      const { studentId } = req.params;
      const { academic_year } = req.query;

      if (!academic_year) {
        return res.status(400).send({ error: "academic_year is required" });
      }

      // Use aggregation to include names
      const result = await yearlyReportsCollection
        .aggregate([
          {
            $match: {
              student_id: studentId,
              academic_year: academic_year,
              report_type: "beginning_of_year",
            },
          },
          {
            $addFields: {
              student_id_obj: { $toObjectId: "$student_id" },
              teacher_id_obj: { $toObjectId: "$teacher_id" },
              class_id_obj: { $toObjectId: "$class_id" },
            },
          },
          {
            $lookup: {
              from: "students",
              localField: "student_id_obj",
              foreignField: "_id",
              as: "student_info",
            },
          },
          {
            $unwind: {
              path: "$student_info",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $lookup: {
              from: "teachers",
              localField: "teacher_id_obj",
              foreignField: "_id",
              as: "teacher_info",
            },
          },
          {
            $unwind: {
              path: "$teacher_info",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $lookup: {
              from: "classes",
              localField: "class_id_obj",
              foreignField: "_id",
              as: "class_info",
            },
          },
          {
            $unwind: {
              path: "$class_info",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $addFields: {
              student_name: "$student_info.name",
              teacher_name: "$teacher_info.name",
              class_name: "$class_info.class_name",
            },
          },
          {
            $project: {
              student_id_obj: 0,
              teacher_id_obj: 0,
              class_id_obj: 0,
              student_info: 0,
              teacher_info: 0,
              class_info: 0,
            },
          },
        ])
        .next();

      if (!result) {
        return res.status(404).send({
          message: "Beginning of year report not found",
        });
      }

      res.send(result);
    } catch (error) {
      console.error("Error fetching beginning report:", error);
      res.status(500).send({ error: error.message });
    }
  });

  // ==================== GET END OF YEAR ====================
  router.get("/student/:studentId/ending", async (req, res) => {
    try {
      const { studentId } = req.params;
      const { academic_year } = req.query;

      if (!academic_year) {
        return res.status(400).send({ error: "academic_year is required" });
      }

      // Use aggregation to include names
      const result = await yearlyReportsCollection
        .aggregate([
          {
            $match: {
              student_id: studentId,
              academic_year: academic_year,
              report_type: "end_of_year",
            },
          },
          {
            $addFields: {
              student_id_obj: { $toObjectId: "$student_id" },
              teacher_id_obj: { $toObjectId: "$teacher_id" },
              class_id_obj: { $toObjectId: "$class_id" },
            },
          },
          {
            $lookup: {
              from: "students",
              localField: "student_id_obj",
              foreignField: "_id",
              as: "student_info",
            },
          },
          {
            $unwind: {
              path: "$student_info",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $lookup: {
              from: "teachers",
              localField: "teacher_id_obj",
              foreignField: "_id",
              as: "teacher_info",
            },
          },
          {
            $unwind: {
              path: "$teacher_info",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $lookup: {
              from: "classes",
              localField: "class_id_obj",
              foreignField: "_id",
              as: "class_info",
            },
          },
          {
            $unwind: {
              path: "$class_info",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $addFields: {
              student_name: "$student_info.name",
              teacher_name: "$teacher_info.name",
              class_name: "$class_info.class_name",
            },
          },
          {
            $project: {
              student_id_obj: 0,
              teacher_id_obj: 0,
              class_id_obj: 0,
              student_info: 0,
              teacher_info: 0,
              class_info: 0,
            },
          },
        ])
        .next();

      if (!result) {
        return res.status(404).send({
          message: "End of year report not found",
        });
      }

      res.send(result);
    } catch (error) {
      console.error("Error fetching ending report:", error);
      res.status(500).send({ error: error.message });
    }
  });

  // ==================== CREATE NEW REPORT ====================
  router.post("/", async (req, res) => {
    try {
      const newReport = req.body;

      // Validate required fields
      const requiredFields = [
        "student_id",
        "teacher_id",
        "class_id",
        "department_id",
        "academic_year",
        "report_type",
        "type",
        "lessons",
      ];

      for (const field of requiredFields) {
        if (!newReport[field]) {
          return res.status(400).send({
            error: `${field} is required`,
          });
        }
      }

      // Check if report already exists
      const existing = await yearlyReportsCollection.findOne({
        student_id: newReport.student_id,
        academic_year: newReport.academic_year,
        report_type: newReport.report_type,
      });

      if (existing) {
        return res.status(400).send({
          error: `${newReport.report_type} report already exists for this student in ${newReport.academic_year}`,
        });
      }

      // Add timestamps
      newReport.created_at = new Date().toISOString();
      newReport.updated_at = new Date().toISOString();
      newReport.is_published = false;

      // Initialize notes array if not present
      if (!newReport.notes) {
        newReport.notes = [];
      }

      const result = await yearlyReportsCollection.insertOne(newReport);
      res.send({
        success: true,
        insertedId: result.insertedId,
        message: "Report created successfully",
      });
    } catch (error) {
      console.error("Error creating yearly report:", error);
      res.status(500).send({ error: error.message });
    }
  });

  // ==================== UPDATE REPORT ====================
  router.put("/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const updateData = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ error: "Invalid ID format" });
      }

      delete updateData._id;
      updateData.updated_at = new Date().toISOString();

      const result = await yearlyReportsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateData },
      );

      if (result.matchedCount === 0) {
        return res.status(404).send({ error: "Report not found" });
      }

      res.send({
        success: true,
        modifiedCount: result.modifiedCount,
        message: "Report updated successfully",
      });
    } catch (error) {
      console.error("Error updating yearly report:", error);
      res.status(500).send({ error: error.message });
    }
  });

  // ==================== ADD NOTE TO REPORT ====================
  router.patch("/:id/notes", async (req, res) => {
    try {
      const { id } = req.params;
      const { text, teacher_id } = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ error: "Invalid ID format" });
      }

      if (!text) {
        return res.status(400).send({ error: "Note text is required" });
      }

      const newNote = {
        id: Date.now(),
        text: text,
        date: new Date().toISOString(),
        teacher_id: teacher_id || null,
      };

      const result = await yearlyReportsCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $push: { notes: newNote },
          $set: { updated_at: new Date().toISOString() },
        },
      );

      if (result.matchedCount === 0) {
        return res.status(404).send({ error: "Report not found" });
      }

      res.send({
        success: true,
        note: newNote,
        message: "Note added successfully",
      });
    } catch (error) {
      console.error("Error adding note:", error);
      res.status(500).send({ error: error.message });
    }
  });

  // ==================== DELETE NOTE FROM REPORT ====================
  router.delete("/:id/notes/:noteId", async (req, res) => {
    try {
      const { id, noteId } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ error: "Invalid ID format" });
      }

      const result = await yearlyReportsCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $pull: { notes: { id: parseInt(noteId) } },
          $set: { updated_at: new Date().toISOString() },
        },
      );

      if (result.matchedCount === 0) {
        return res.status(404).send({ error: "Report not found" });
      }

      res.send({
        success: true,
        modifiedCount: result.modifiedCount,
        message: "Note deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting note:", error);
      res.status(500).send({ error: error.message });
    }
  });

  // ==================== DELETE REPORT ====================
  router.delete("/:id", async (req, res) => {
    try {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ error: "Invalid ID format" });
      }

      const result = await yearlyReportsCollection.deleteOne({
        _id: new ObjectId(id),
      });

      if (result.deletedCount === 0) {
        return res.status(404).send({ error: "Report not found" });
      }

      res.send({
        success: true,
        deletedCount: result.deletedCount,
        message: "Report deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting report:", error);
      res.status(500).send({ error: error.message });
    }
  });

  // ==================== GET STUDENTS WITHOUT BEGINNING REPORT ====================
  router.get("/missing-beginning/:classId", async (req, res) => {
    try {
      const { classId } = req.params;
      const { academic_year } = req.query;

      if (!academic_year) {
        return res.status(400).send({ error: "academic_year is required" });
      }

      const studentsWithReport = await yearlyReportsCollection.distinct(
        "student_id",
        {
          class_id: classId,
          academic_year: academic_year,
          report_type: "beginning_of_year",
        },
      );

      res.send({
        class_id: classId,
        academic_year: academic_year,
        students_with_report: studentsWithReport,
        count: studentsWithReport.length,
      });
    } catch (error) {
      console.error("Error getting missing reports:", error);
      res.status(500).send({ error: error.message });
    }
  });

  return router;
};
