const express = require("express");
const { messaging } = require("firebase-admin");
const router = express.Router();
const { ObjectId } = require("mongodb");
const {
  buildMonthlySummaryPipeline,
  buildYearlySummaryPipeline,
  buildTeacherMonthlySummaryPipeline,
  buildTeacherYearlySummaryPipeline,
  buildStudentMonthlySummaryPipeline,
  buildStudentYearlySummaryPipeline, // Add this
} = require("../utils/lessonsCoveredUtils");

module.exports = (
  lessonsCoveredCollection,
  studentsCollection,
  teachersCollection,
) => {
  // Existing routes
  router.get("/", async (req, res) => {
    const result = await lessonsCoveredCollection.find().toArray();
    res.send(result);
  });

  router.post("/", async (req, res) => {
    const newLesson = req.body;
    const { month, year, student_id, time_of_month, class_id, lessons } =
      newLesson;

    if (
      !month ||
      !year ||
      !student_id ||
      !time_of_month ||
      !class_id ||
      !lessons
    ) {
      return res.status(400).send({
        message:
          "month, year, student, time of month, class, and lessons are required. Check again",
      });
    }

    try {
      // 🚫 Check duplicate (same student + same month/year + same time_of_month)
      const duplicate = await lessonsCoveredCollection.findOne({
        student_id,
        year,
        month,
        time_of_month,
      });

      if (duplicate) {
        return res.status(400).send({
          message: `A ${time_of_month} report already exists for this student in ${month}/${year}.`,
        });
      }

      // ✅ If this is "end of month", check subject consistency with "beginning"
      if (time_of_month === "ending") {
        const beginningLesson = await lessonsCoveredCollection.findOne({
          student_id,
          year,
          month,
          time_of_month: "beginning",
        });

        if (beginningLesson) {
          const beginningSubjects = Object.keys(beginningLesson.lessons || {});
          const endSubjects = Object.keys(lessons);

          // Check if the same subjects are present
          const mismatch = endSubjects.filter(
            (subj) => !beginningSubjects.includes(subj),
          );

          if (mismatch.length > 0) {
            return res.status(400).send({
              message: `Subject mismatch detected between beginning and end of the month.`,
              details: {
                beginningSubjects,
                endSubjects,
                wrongSubjects: mismatch,
              },
            });
          }

          // Check if qaidah_quran selection is consistent
          if (lessons.qaidah_quran && beginningLesson.lessons.qaidah_quran) {
            if (
              lessons.qaidah_quran.selected !==
              beginningLesson.lessons.qaidah_quran.selected
            ) {
              return res.status(400).send({
                message: `Quran subject selection mismatch. Beginning was "${beginningLesson.lessons.qaidah_quran.selected}" but ending is "${lessons.qaidah_quran.selected}".`,
              });
            }
          }
        }
      }

      // ✅ Insert new lesson
      const result = await lessonsCoveredCollection.insertOne(newLesson);
      res.send(result);
    } catch (error) {
      console.error("Error inserting lesson:", error);
      res.status(500).send({
        message: "Something went wrong while inserting the lesson.",
        error: error.message,
      });
    }
  });

  // Route to get previous month's ending data for pre-filling beginning
  router.get("/previous-month-ending/:student_id", async (req, res) => {
    try {
      const { student_id } = req.params;
      const { month, year } = req.query;

      if (!month || !year) {
        return res.status(400).send({
          message: "Month and year parameters are required",
        });
      }

      // Convert month name to number for calculation
      const monthNames = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ];

      const currentMonthIndex = monthNames.indexOf(month);
      if (currentMonthIndex === -1) {
        return res.status(400).send({
          message: "Invalid month name",
        });
      }

      // Calculate previous month and year
      let prevMonthIndex = currentMonthIndex - 1;
      let prevYear = parseInt(year);

      if (prevMonthIndex < 0) {
        prevMonthIndex = 11; // December
        prevYear = prevYear - 1;
      }

      const prevMonth = monthNames[prevMonthIndex];

      console.log(
        `🔍 Looking for: ${prevMonth} ${prevYear} (previous to ${month} ${year})`,
      );

      // SIMPLE FIX: Just find the ending data for the calculated previous month/year
      const previousEnding = await lessonsCoveredCollection.findOne({
        student_id: student_id,
        month: prevMonth,
        year: prevYear.toString(),
        time_of_month: "ending",
      });

      if (!previousEnding) {
        return res.status(404).send({
          message: `No ending data found for previous month (${prevMonth} ${prevYear})`,
        });
      }

      console.log(
        `✅ Found previous data: ${previousEnding.month} ${previousEnding.year}`,
      );

      // Return the previous month's ending document
      res.send(previousEnding);
    } catch (error) {
      console.error("Error fetching previous month ending:", error);
      res.status(500).send({
        message: "Something went wrong while fetching previous month data",
        error: error.message,
      });
    }
  });
  router.get("/monthly-summary", async (req, res) => {
    try {
      const { year, month } = req.query;

      // Create match conditions - only unpublished monthly reports
      const matchConditions = {
        monthly_publish: false,
      };

      if (year) matchConditions.year = year;
      if (month) matchConditions.month = month;

      const pipeline = buildMonthlySummaryPipeline(matchConditions);

      const result = await lessonsCoveredCollection
        .aggregate(pipeline)
        .toArray();

      console.log(
        `Found ${result.length} complete student records for ${month} ${year}`,
      );

      res.send(result.length > 0 ? result : []);
    } catch (error) {
      console.error("Monthly summary error:", error);
      res.status(500).send({
        error: "Internal server error",
        details: error.message,
      });
    }
  });
  // Update your yearly-summary route
  router.get("/yearly-summary", async (req, res) => {
    try {
      const { year } = req.query;

      if (!year) {
        return res.status(400).send({ error: "year parameter is required" });
      }

      const pipeline = buildYearlySummaryPipeline(year);

      const result = await lessonsCoveredCollection
        .aggregate(pipeline)
        .toArray();

      console.log(
        `Yearly summary found ${result.length} records for year ${year}`,
      );
      return res.status(200).json(Array.isArray(result) ? result : []);
    } catch (error) {
      console.error("Yearly summary error:", error);
      return res.status(500).json({
        error: "Internal server error",
        details: error.message,
      });
    }
  });
  // Teacher monthly summary route
  router.get("/teacher-monthly-summary/:teacher_id", async (req, res) => {
    try {
      const { teacher_id } = req.params;
      const { month, year } = req.query;

      console.log("Teacher monthly summary request:", {
        teacher_id,
        month,
        year,
      });

      if (!teacher_id) {
        return res.status(400).send({ error: "Teacher ID is required" });
      }

      // Create match conditions - only unpublished monthly reports for this teacher
      const matchConditions = {
        teacher_id: teacher_id,
        monthly_publish: false,
      };

      if (year) matchConditions.year = year;
      if (month) matchConditions.month = month;

      console.log("Match conditions:", matchConditions);

      const pipeline = buildTeacherMonthlySummaryPipeline(matchConditions);

      const result = await lessonsCoveredCollection
        .aggregate(pipeline)
        .toArray();

      console.log(
        `Found ${result.length} complete student records for teacher ${teacher_id}`,
      );

      res.send(result.length > 0 ? result : []);
    } catch (error) {
      console.error("Teacher monthly summary error:", error);
      res.status(500).send({
        error: "Internal server error",
        details: error.message,
      });
    }
  });

  router.get("/teacher-yearly-summary/:teacher_id", async (req, res) => {
    try {
      const { teacher_id } = req.params;
      const { year } = req.query;

      if (!year) {
        return res.status(400).send({ error: "year parameter is required" });
      }

      const pipeline = buildTeacherYearlySummaryPipeline(teacher_id, year);

      const result = await lessonsCoveredCollection
        .aggregate(pipeline)
        .toArray();

      console.log(
        `Yearly summary found ${result.length} records for teacher ${teacher_id} year ${year}`,
      );

      return res.status(200).json(Array.isArray(result) ? result : []);
    } catch (error) {
      console.error("Teacher yearly summary error:", error);
      return res.status(500).json({
        error: "Internal server error",
        details: error.message,
      });
    }
  });

  // Student monthly summary route
  router.get("/student-monthly-summary", async (req, res) => {
    try {
      const { month, year, student_ids } = req.query;

      if (!year || !student_ids) {
        return res.status(400).send({
          error: "year and student_ids parameters are required",
        });
      }

      const studentIdsArray = student_ids.split(",");

      // Match conditions (only published monthly reports for students)
      const matchConditions = {
        student_id: { $in: studentIdsArray },
        monthly_publish: true, // Only published reports for parent dashboard
        year,
      };
      if (month) matchConditions.month = month;

      console.log("Student monthly summary request:", {
        student_ids: studentIdsArray,
        month,
        year,
        matchConditions,
      });

      const pipeline = buildStudentMonthlySummaryPipeline(matchConditions);

      const result = await lessonsCoveredCollection
        .aggregate(pipeline)
        .toArray();

      console.log(
        `Found ${result.length} published monthly reports for students ${studentIdsArray}`,
      );

      res.send(result.length > 0 ? result : []);
    } catch (error) {
      console.error("Student monthly summary error:", error);
      res.status(500).send({
        error: "Internal server error",
        details: error.message,
      });
    }
  });

  router.get("/student-yearly-summary", async (req, res) => {
    try {
      const { year, student_ids } = req.query;

      if (!year || !student_ids) {
        return res.status(400).send({
          error: "year and student_ids parameters are required",
        });
      }

      // Convert comma-separated string to array
      const studentIdsArray = student_ids.split(",");

      const pipeline = buildStudentYearlySummaryPipeline(studentIdsArray, year);

      const result = await lessonsCoveredCollection
        .aggregate(pipeline)
        .toArray();

      console.log(
        `Student yearly summary found ${result.length} records for students ${studentIdsArray} year ${year}`,
      );

      res.send(result.length > 0 ? result : []);
    } catch (error) {
      console.error("Student yearly summary error:", error);
      res.status(500).send({
        error: "Internal server error",
        details: error.message,
      });
    }
  });

  router.get("/teacher-students-progress/:teacher_id", async (req, res) => {
    try {
      const { teacher_id } = req.params;
      const { student_name, month, year } = req.query;

      if (!teacher_id) {
        return res
          .status(400)
          .send({ error: "teacher_id parameter is required" });
      }

      const pipeline = [
        { $match: { teacher_id } },

        // Convert student_id to ObjectId
        {
          $addFields: {
            student_id_obj: { $toObjectId: "$student_id" },
          },
        },

        // Lookup student info
        {
          $lookup: {
            from: "students",
            localField: "student_id_obj",
            foreignField: "_id",
            as: "student_info",
          },
        },
        { $unwind: "$student_info" },
        { $addFields: { student_name: "$student_info.name" } },

        // Optional filtering
        {
          $match: {
            ...(student_name && {
              student_name: { $regex: student_name, $options: "i" },
            }),
            ...(month && { month }),
            ...(year && { year }),
          },
        },

        // Group by student, month, year to combine beginning and ending
        {
          $group: {
            _id: {
              student_id: "$student_id",
              month: "$month",
              year: "$year",
            },
            student_name: { $first: "$student_name" },
            month: { $first: "$month" },
            year: { $first: "$year" },
            type: { $first: "$type" }, // 👈 carry education type
            beginning: {
              $push: {
                $cond: [
                  { $eq: ["$time_of_month", "beginning"] },
                  {
                    _id: "$_id",
                    lessons: "$lessons",
                    description: "$description",
                    date: "$date",
                    type: "$type", // 👈 keep inside too if you want
                  },
                  "$$REMOVE",
                ],
              },
            },
            ending: {
              $push: {
                $cond: [
                  { $eq: ["$time_of_month", "ending"] },
                  {
                    _id: "$_id",
                    lessons: "$lessons",
                    description: "$description",
                    date: "$date",
                    type: "$type", // 👈 keep inside too if you want
                  },
                  "$$REMOVE",
                ],
              },
            },
          },
        },

        // Unwind the arrays (they should only have one element each)
        {
          $addFields: {
            beginning: { $arrayElemAt: ["$beginning", 0] },
            ending: { $arrayElemAt: ["$ending", 0] },
          },
        },

        // Final projection
        {
          $project: {
            _id: 0,
            student_id: "$_id.student_id",
            student_name: 1,
            month: 1,
            type: 1,
            year: 1,
            beginning: 1,
            ending: 1,
          },
        },

        // Sort by student, year, month
        {
          $sort: {
            student_name: 1,
            year: 1,
            month: 1,
          },
        },
      ];

      const result = await lessonsCoveredCollection
        .aggregate(pipeline)
        .toArray();
      res.send(result);
    } catch (error) {
      console.error(error);
      res.status(500).send({ error: "Internal server error" });
    }
  });
  router.put("/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const updatedData = req.body;
      const { lessons } = updatedData;

      // Validate ObjectId format
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ error: "Invalid ID format" });
      }

      // Remove _id from update data to prevent modification
      delete updatedData._id;

      // Get the existing document
      const existingLesson = await lessonsCoveredCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!existingLesson) {
        return res.status(404).send({ error: "Document not found" });
      }

      // Update the document
      const result = await lessonsCoveredCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedData },
      );

      if (result.matchedCount === 0) {
        return res.status(404).send({ error: "Document not found" });
      }

      res.send({
        success: true,
        modifiedCount: result.modifiedCount,
        message: "Update successful",
      });
    } catch (error) {
      console.error("Update error:", error);
      res.status(500).send({ error: "Update failed", details: error.message });
    }
  });
  // PATCH /api/lessons_covered/publish/:id
  // PATCH /publish-multiple
  router.patch("/publish-multiple", async (req, res) => {
    const { ids, monthly_publish, yearly_publish } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res
        .status(400)
        .send({ success: false, message: "No document IDs provided." });
    }

    // Determine which field to publish
    const updateFields = {
      published_at: new Date(),
    };

    if (monthly_publish === true) {
      updateFields.monthly_publish = true;
    }
    if (yearly_publish === true) {
      updateFields.yearly_publish = true;
    }

    // If neither flag is sent
    if (!updateFields.monthly_publish && !updateFields.yearly_publish) {
      return res
        .status(400)
        .send({ success: false, message: "No publish type specified." });
    }

    try {
      const result = await lessonsCoveredCollection.updateMany(
        { _id: { $in: ids.map((id) => new ObjectId(id)) } },
        {
          $set: updateFields,
        },
      );

      res.send({
        success: true,
        modifiedCount: result.modifiedCount,
        message: `${result.modifiedCount} records updated.`,
      });
    } catch (err) {
      res.status(500).send({ success: false, message: "Server error." });
    }
  });

  router.delete("/delete-many", async (req, res) => {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res
        .status(400)
        .json({ error: "ids array is required in request body" });
    }

    const objectIds = ids.map((id) => new ObjectId(id));
    const result = await lessonsCoveredCollection.deleteMany({
      _id: { $in: objectIds },
    });

    res.send({ success: true, deletedCount: result.deletedCount });
  });
  return router;
};
