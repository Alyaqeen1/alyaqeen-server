const express = require("express");
const { messaging } = require("firebase-admin");
const router = express.Router();
const { ObjectId } = require("mongodb");

module.exports = (lessonsCoveredCollection) => {
  // Existing routes
  router.get("/", async (req, res) => {
    const result = await lessonsCoveredCollection.find().toArray();
    res.send(result);
  });

  router.post("/", async (req, res) => {
    const newLesson = req.body;
    const { month, year, student_id, subject_id, time_of_month } = newLesson;

    // Validation
    if (!month || !year || !student_id || !subject_id || !time_of_month) {
      return res.status(400).send({
        error:
          "month, year, student_id, subject_id, and time_of_month are required",
      });
    }

    try {
      // Fetch existing lessons for the same student, subject, month, and year
      const existingLessons = await lessonsCoveredCollection
        .find({ month, year, student_id, subject_id })
        .toArray();

      // Check for duplicate time_of_month for this subject
      const duplicate = existingLessons.find(
        (l) => l.time_of_month === time_of_month
      );

      if (duplicate) {
        return res.status(400).send({
          message: `A "${time_of_month}" lesson for this subject already exists for the selected student and month.`,
        });
      }

      // Check if both "beginning" and "ending" already exist for this subject
      const hasBeginning = existingLessons.some(
        (l) => l.time_of_month === "beginning"
      );
      const hasEnding = existingLessons.some(
        (l) => l.time_of_month === "ending"
      );

      if (hasBeginning && hasEnding) {
        return res.status(400).send({
          message: `Both "beginning" and "ending" lessons already exist for this subject and student in this month.`,
        });
      }

      // Insert new lesson
      const result = await lessonsCoveredCollection.insertOne({
        ...newLesson,
      });

      res.send(result);
    } catch (error) {
      console.error("Insert Error:", error);
      res.status(500).send({
        message: "Something went wrong while inserting the lesson.",
      });
    }
  });

  // New aggregation route for monthly summaries
  router.get("/monthly-summary", async (req, res) => {
    try {
      const { year, month } = req.query;

      // Create match conditions - use year as-is without conversion
      const matchConditions = {};
      if (year) matchConditions.year = year; // Keep as string if that's how it's stored
      if (month) matchConditions.month = month;

      const pipeline = [
        // Optional debug stage to check data before filtering
        /* {
        $limit: 1,
        $project: {
          debug: {
            storedYear: "$year",
            storedMonth: "$month",
            yearType: { $type: "$year" },
            monthType: { $type: "$month" }
          }
        }
      }, */

        // Add initial match stage if filters are provided
        ...(Object.keys(matchConditions).length
          ? [{ $match: matchConditions }]
          : []),

        // Convert string IDs to ObjectId
        {
          $addFields: {
            student_id: { $toObjectId: "$student_id" },
            class_id: { $toObjectId: "$class_id" },
            subject_id: { $toObjectId: "$subject_id" },
            teacher_id: { $toObjectId: "$teacher_id" },
            department_id: { $toObjectId: "$department_id" },
          },
        },

        // Group by student, month, and year (using the stored fields)
        {
          $group: {
            _id: {
              student_id: "$student_id",
              month: "$month",
              year: "$year", // Using the stored year field directly
            },
            entries: {
              $push: {
                time_of_month: "$time_of_month",
                qaidahPages: { $toInt: "$qaidahPages" },
                duasSurahs: { $toInt: "$duasSurahs" },
                islamicStudiesPages: { $toInt: "$islamicStudiesPages" },
              },
            },
            book_names: { $addToSet: "$book_name" },
            class_id: { $first: "$class_id" },
            subject_id: { $first: "$subject_id" },
            teacher_id: { $first: "$teacher_id" },
            department_id: { $first: "$department_id" },
          },
        },

        // Separate beginning and ending entries
        {
          $project: {
            _id: 0,
            student_id: "$_id.student_id",
            month: "$_id.month",
            year: "$_id.year",
            book_names: 1,
            class_id: 1,
            subject_id: 1,
            teacher_id: 1,
            department_id: 1,
            beginning: {
              $arrayElemAt: [
                {
                  $filter: {
                    input: "$entries",
                    as: "entry",
                    cond: { $eq: ["$$entry.time_of_month", "beginning"] },
                  },
                },
                0,
              ],
            },
            ending: {
              $arrayElemAt: [
                {
                  $filter: {
                    input: "$entries",
                    as: "entry",
                    cond: { $eq: ["$$entry.time_of_month", "ending"] },
                  },
                },
                0,
              ],
            },
          },
        },

        // Only include documents with ending entry
        {
          $match: {
            ending: { $ne: null },
          },
        },

        // Calculate progress (from 0 if no beginning exists)
        {
          $project: {
            student_id: 1,
            month: 1,
            year: 1,
            book_names: 1,
            class_id: 1,
            subject_id: 1,
            teacher_id: 1,
            department_id: 1,
            qaidahProgress: {
              $subtract: [
                "$ending.qaidahPages",
                { $ifNull: ["$beginning.qaidahPages", 0] },
              ],
            },
            duasSurahsProgress: {
              $subtract: [
                "$ending.duasSurahs",
                { $ifNull: ["$beginning.duasSurahs", 0] },
              ],
            },
            islamicStudiesProgress: {
              $subtract: [
                "$ending.islamicStudiesPages",
                { $ifNull: ["$beginning.islamicStudiesPages", 0] },
              ],
            },
            hasBeginning: { $ne: ["$beginning", null] },
            hasEnding: true,
          },
        },

        // Lookup related data
        {
          $lookup: {
            from: "students",
            localField: "student_id",
            foreignField: "_id",
            as: "student_info",
          },
        },
        {
          $unwind: { path: "$student_info", preserveNullAndEmptyArrays: true },
        },

        {
          $lookup: {
            from: "classes",
            localField: "class_id",
            foreignField: "_id",
            as: "class_info",
          },
        },
        { $unwind: { path: "$class_info", preserveNullAndEmptyArrays: true } },

        {
          $lookup: {
            from: "subjects",
            localField: "subject_id",
            foreignField: "_id",
            as: "subject_info",
          },
        },
        {
          $unwind: { path: "$subject_info", preserveNullAndEmptyArrays: true },
        },

        // Final projection
        {
          $project: {
            student_id: 1,
            student_name: "$student_info.name",
            teacher_id: 1,
            month: 1,
            year: 1,
            book_names: 1,
            class_name: "$class_info.class_name",
            subject_name: "$subject_info.subject_name",
            qaidahProgress: 1,
            duasSurahsProgress: 1,
            islamicStudiesProgress: 1,
            hasBeginning: 1,
            hasEnding: 1,
          },
        },
      ];

      const result = await lessonsCoveredCollection
        .aggregate(pipeline)
        .toArray();

      res.send(result);
    } catch (error) {
      console.error("Error in monthly-summary:", error);
      res.status(500).send({
        error: "Internal server error",
        details: error.message,
      });
    }
  });

  // Add this new route after your monthly-summary route
  router.get("/yearly-summary", async (req, res) => {
    try {
      const { year } = req.query;

      if (!year) {
        return res.status(400).send({ error: "year parameter is required" });
      }

      const pipeline = [
        // Match documents for the specific year
        {
          $match: {
            year: year,
          },
        },
        // Convert string IDs to ObjectId
        {
          $addFields: {
            student_id: { $toObjectId: "$student_id" },
            class_id: { $toObjectId: "$class_id" },
            subject_id: { $toObjectId: "$subject_id" },
            teacher_id: { $toObjectId: "$teacher_id" },
          },
        },
        // First group by student and month to separate beginning/ending entries
        {
          $group: {
            _id: {
              student_id: "$student_id",
              month: "$month",
              class_id: "$class_id",
              subject_id: "$subject_id",
            },
            entries: {
              $push: {
                time_of_month: "$time_of_month",
                qaidahPages: { $toInt: "$qaidahPages" },
                duasSurahs: { $toInt: "$duasSurahs" },
                islamicStudiesPages: { $toInt: "$islamicStudiesPages" },
              },
            },
            book_names: { $addToSet: "$book_name" },
          },
        },
        // Separate beginning and ending entries for each month
        {
          $project: {
            _id: 0,
            student_id: "$_id.student_id",
            month: "$_id.month",
            class_id: "$_id.class_id",
            subject_id: "$_id.subject_id",
            book_names: 1,
            beginning: {
              $arrayElemAt: [
                {
                  $filter: {
                    input: "$entries",
                    as: "entry",
                    cond: { $eq: ["$$entry.time_of_month", "beginning"] },
                  },
                },
                0,
              ],
            },
            ending: {
              $arrayElemAt: [
                {
                  $filter: {
                    input: "$entries",
                    as: "entry",
                    cond: { $eq: ["$$entry.time_of_month", "ending"] },
                  },
                },
                0,
              ],
            },
          },
        },
        // Only include months that have ending (may or may not have beginning)
        {
          $match: {
            ending: { $ne: null },
          },
        },

        // Calculate monthly progress (from 0 if no beginning exists)
        {
          $project: {
            student_id: 1,
            month: 1,
            class_id: 1,
            subject_id: 1,
            book_names: 1,
            qaidahProgress: {
              $subtract: [
                "$ending.qaidahPages",
                { $ifNull: ["$beginning.qaidahPages", 0] },
              ],
            },
            duasSurahsProgress: {
              $subtract: [
                "$ending.duasSurahs",
                { $ifNull: ["$beginning.duasSurahs", 0] },
              ],
            },
            islamicStudiesProgress: {
              $subtract: [
                "$ending.islamicStudiesPages",
                { $ifNull: ["$beginning.islamicStudiesPages", 0] },
              ],
            },
            hasBeginning: { $ne: ["$beginning", null] },
          },
        },
        // Now group to calculate yearly totals per student
        {
          $group: {
            _id: {
              student_id: "$student_id",
              class_id: "$class_id",
              subject_id: "$subject_id",
            },
            book_names: { $addToSet: "$book_name" },
            qaidahYearlyProgress: { $sum: "$qaidahProgress" },
            duasSurahsYearlyProgress: { $sum: "$duasSurahsProgress" },
            islamicStudiesYearlyProgress: { $sum: "$islamicStudiesProgress" },
            months_with_ending: { $sum: 1 }, // Total months with ending
            months_with_both: {
              $sum: {
                $cond: [{ $eq: ["$hasBeginning", true] }, 1, 0],
              },
            },
          },
        },
        // Add year and format output
        {
          $project: {
            _id: 0,
            student_id: "$_id.student_id",
            class_id: "$_id.class_id",
            subject_id: "$_id.subject_id",
            book_names: 1,
            year: 1, // Final year field
            qaidahYearlyProgress: 1,
            duasSurahsYearlyProgress: 1,
            islamicStudiesYearlyProgress: 1,
            months_with_ending: 1,
            months_with_both: 1,
            year: parseInt(year),
          },
        },
        // Lookup related data
        {
          $lookup: {
            from: "students",
            localField: "student_id",
            foreignField: "_id",
            as: "student_info",
          },
        },
        { $unwind: "$student_info" },
        {
          $lookup: {
            from: "classes",
            localField: "class_id",
            foreignField: "_id",
            as: "class_info",
          },
        },
        { $unwind: "$class_info" },
        {
          $lookup: {
            from: "subjects",
            localField: "subject_id",
            foreignField: "_id",
            as: "subject_info",
          },
        },
        { $unwind: "$subject_info" },
        {
          $addFields: {
            year: parseInt(year),
          },
        },

        // Final projection
        {
          $project: {
            _id: 0,
            student_id: "$_id.student_id",
            class_id: "$_id.class_id",
            subject_id: "$_id.subject_id",
            book_names: 1,
            qaidahYearlyProgress: 1,
            duasSurahsYearlyProgress: 1,
            islamicStudiesYearlyProgress: 1,
            months_with_ending: 1,
            months_with_both: 1,
          },
        },
        {
          $addFields: {
            year: parseInt(year),
          },
        },
      ];

      const result = await lessonsCoveredCollection
        .aggregate(pipeline)
        .toArray();
      res.send(result);
    } catch (error) {
      console.error("Error in yearly-summary:", error);
      res.status(500).send({ error: "Internal server error" });
    }
  });

  //teacher monthly progress
  router.get("/teacher-monthly-summary/:teacher_id", async (req, res) => {
    try {
      const { teacher_id } = req.params;
      const { month, year } = req.query;

      // Create match conditions - use year as-is without conversion
      const matchConditions = {
        teacher_id: teacher_id, // Always filter by teacher_id
      };

      if (year) matchConditions.year = year; // Keep as string if that's how it's stored
      if (month) matchConditions.month = month;

      const pipeline = [
        // Optional debug stage to check data before filtering
        /* {
        $limit: 1,
        $project: {
          debug: {
            storedYear: "$year",
            storedMonth: "$month",
            yearType: { $type: "$year" },
            monthType: { $type: "$month" },
            teacher_id: 1
          }
        }
      }, */

        // Add initial match stage with teacher_id and optional filters
        {
          $match: matchConditions,
        },

        // Convert string IDs to ObjectId
        {
          $addFields: {
            student_id: { $toObjectId: "$student_id" },
            class_id: { $toObjectId: "$class_id" },
            subject_id: { $toObjectId: "$subject_id" },
            teacher_id: { $toObjectId: "$teacher_id" },
            department_id: { $toObjectId: "$department_id" },
          },
        },

        // Group by student, month, and year (using the stored fields)
        {
          $group: {
            _id: {
              student_id: "$student_id",
              month: "$month",
              year: "$year", // Using the stored year field directly
            },
            entries: {
              $push: {
                time_of_month: "$time_of_month",
                qaidahPages: { $toInt: "$qaidahPages" },
                duasSurahs: { $toInt: "$duasSurahs" },
                islamicStudiesPages: { $toInt: "$islamicStudiesPages" },
              },
            },
            book_names: { $addToSet: "$book_name" },
            class_id: { $first: "$class_id" },
            subject_id: { $first: "$subject_id" },
            teacher_id: { $first: "$teacher_id" },
            department_id: { $first: "$department_id" },
          },
        },

        // Separate beginning and ending entries
        {
          $project: {
            _id: 0,
            student_id: "$_id.student_id",
            month: "$_id.month",
            year: "$_id.year",
            book_names: 1,
            class_id: 1,
            subject_id: 1,
            teacher_id: 1,
            department_id: 1,
            beginning: {
              $arrayElemAt: [
                {
                  $filter: {
                    input: "$entries",
                    as: "entry",
                    cond: { $eq: ["$$entry.time_of_month", "beginning"] },
                  },
                },
                0,
              ],
            },
            ending: {
              $arrayElemAt: [
                {
                  $filter: {
                    input: "$entries",
                    as: "entry",
                    cond: { $eq: ["$$entry.time_of_month", "ending"] },
                  },
                },
                0,
              ],
            },
          },
        },

        // Only include documents with ending entry
        {
          $match: {
            ending: { $ne: null },
          },
        },

        // Calculate progress (from 0 if no beginning exists)
        {
          $project: {
            student_id: 1,
            month: 1,
            year: 1,
            book_names: 1,
            class_id: 1,
            subject_id: 1,
            teacher_id: 1,
            department_id: 1,
            qaidahProgress: {
              $subtract: [
                "$ending.qaidahPages",
                { $ifNull: ["$beginning.qaidahPages", 0] },
              ],
            },
            duasSurahsProgress: {
              $subtract: [
                "$ending.duasSurahs",
                { $ifNull: ["$beginning.duasSurahs", 0] },
              ],
            },
            islamicStudiesProgress: {
              $subtract: [
                "$ending.islamicStudiesPages",
                { $ifNull: ["$beginning.islamicStudiesPages", 0] },
              ],
            },
            hasBeginning: { $ne: ["$beginning", null] },
            hasEnding: true,
          },
        },

        // Lookup related data
        {
          $lookup: {
            from: "students",
            localField: "student_id",
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
            from: "classes",
            localField: "class_id",
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
          $lookup: {
            from: "subjects",
            localField: "subject_id",
            foreignField: "_id",
            as: "subject_info",
          },
        },
        {
          $unwind: {
            path: "$subject_info",
            preserveNullAndEmptyArrays: true,
          },
        },

        // Final projection
        {
          $project: {
            student_id: 1,
            student_name: "$student_info.name",
            teacher_id: 1,
            month: 1,
            year: 1,
            book_names: 1,
            class_name: "$class_info.class_name",
            subject_name: "$subject_info.subject_name",
            qaidahProgress: 1,
            duasSurahsProgress: 1,
            islamicStudiesProgress: 1,
            hasBeginning: 1,
            hasEnding: 1,
          },
        },
      ];

      const result = await lessonsCoveredCollection
        .aggregate(pipeline)
        .toArray();

      if (result.length === 0) {
        return res.status(200).send([]);
      }

      res.send(result);
    } catch (error) {
      console.error("Error in teacher monthly-summary:", error);
      res.status(500).send({
        error: "Internal server error",
        details: error.message,
      });
    }
  });
  // teacher yearly progress
  router.get("/teacher-yearly-summary/:teacher_id", async (req, res) => {
    try {
      const { teacher_id } = req.params;
      const { year } = req.query;

      if (!year) {
        return res.status(400).send({ error: "year parameter is required" });
      }

      const pipeline = [
        // Match documents for the specific teacher and year
        {
          $match: {
            teacher_id: teacher_id,
            year: year,
          },
        },
        // Convert string IDs to ObjectId
        {
          $addFields: {
            student_id: { $toObjectId: "$student_id" },
            class_id: { $toObjectId: "$class_id" },
            subject_id: { $toObjectId: "$subject_id" },
            teacher_id: { $toObjectId: "$teacher_id" },
          },
        },
        // First group by month to separate beginning/ending entries
        {
          $group: {
            _id: {
              student_id: "$student_id",
              month: "$month",
              class_id: "$class_id",
              subject_id: "$subject_id",
            },
            entries: {
              $push: {
                time_of_month: "$time_of_month",
                qaidahPages: { $toInt: "$qaidahPages" },
                duasSurahs: { $toInt: "$duasSurahs" },
                islamicStudiesPages: { $toInt: "$islamicStudiesPages" },
              },
            },
            book_names: { $addToSet: "$book_name" },
          },
        },
        // Separate beginning and ending entries for each month
        {
          $project: {
            _id: 0,
            student_id: "$_id.student_id",
            month: "$_id.month",
            class_id: "$_id.class_id",
            subject_id: "$_id.subject_id",
            book_names: 1,
            beginning: {
              $arrayElemAt: [
                {
                  $filter: {
                    input: "$entries",
                    as: "entry",
                    cond: { $eq: ["$$entry.time_of_month", "beginning"] },
                  },
                },
                0,
              ],
            },
            ending: {
              $arrayElemAt: [
                {
                  $filter: {
                    input: "$entries",
                    as: "entry",
                    cond: { $eq: ["$$entry.time_of_month", "ending"] },
                  },
                },
                0,
              ],
            },
          },
        },
        // Only include months that have ending (may or may not have beginning)
        {
          $match: {
            ending: { $ne: null },
          },
        },
        // Calculate monthly progress (from 0 if no beginning exists)
        {
          $project: {
            student_id: 1,
            month: 1,
            class_id: 1,
            subject_id: 1,
            book_names: 1,
            qaidahProgress: {
              $subtract: [
                "$ending.qaidahPages",
                { $ifNull: ["$beginning.qaidahPages", 0] },
              ],
            },
            duasSurahsProgress: {
              $subtract: [
                "$ending.duasSurahs",
                { $ifNull: ["$beginning.duasSurahs", 0] },
              ],
            },
            islamicStudiesProgress: {
              $subtract: [
                "$ending.islamicStudiesPages",
                { $ifNull: ["$beginning.islamicStudiesPages", 0] },
              ],
            },
            hasBeginning: { $ne: ["$beginning", null] },
          },
        },
        // Now group to calculate yearly totals
        {
          $group: {
            _id: {
              student_id: "$student_id",
              class_id: "$class_id",
              subject_id: "$subject_id",
            },
            book_names: { $addToSet: "$book_name" },
            qaidahYearlyProgress: { $sum: "$qaidahProgress" },
            duasSurahsYearlyProgress: { $sum: "$duasSurahsProgress" },
            islamicStudiesYearlyProgress: { $sum: "$islamicStudiesProgress" },
            months_with_ending: { $sum: 1 }, // Total months with ending
            months_with_both: {
              $sum: {
                $cond: [{ $eq: ["$hasBeginning", true] }, 1, 0],
              },
            },
          },
        },

        // Add year and format output
        {
          $project: {
            _id: 0,
            student_id: "$_id.student_id",
            class_id: "$_id.class_id",
            subject_id: "$_id.subject_id",
            book_names: 1,
            qaidahYearlyProgress: 1,
            duasSurahsYearlyProgress: 1,
            islamicStudiesYearlyProgress: 1,
            months_with_ending: 1,
            months_with_both: 1,
            year: parseInt(year),
          },
        },
        // Lookup related data
        {
          $lookup: {
            from: "students",
            localField: "student_id",
            foreignField: "_id",
            as: "student_info",
          },
        },
        { $unwind: "$student_info" },
        {
          $lookup: {
            from: "classes",
            localField: "class_id",
            foreignField: "_id",
            as: "class_info",
          },
        },
        { $unwind: "$class_info" },
        {
          $lookup: {
            from: "subjects",
            localField: "subject_id",
            foreignField: "_id",
            as: "subject_info",
          },
        },
        { $unwind: "$subject_info" },
        {
          $addFields: {
            year: parseInt(year),
          },
        },
        // Final projection
        {
          $project: {
            student_id: 1,
            student_name: "$student_info.name",
            year: 1,
            book_names: 1,
            class_name: "$class_info.class_name",
            subject_name: "$subject_info.subject_name",
            qaidahYearlyProgress: 1,
            duasSurahsYearlyProgress: 1,
            islamicStudiesYearlyProgress: 1,
            months_with_ending: 1,
            months_with_both: 1,
          },
        },
        {
          $addFields: {
            year: parseInt(year),
          },
        },
      ];

      const result = await lessonsCoveredCollection
        .aggregate(pipeline)
        .toArray();

      // Force empty array response - THREE different safeguards:
      if (!result || !Array.isArray(result) || result.length === 0) {
        return res.status(200).json(Array.isArray(result) ? result : []);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Error:", error);
      return res.status(200).json([]); // Even on error, return empty array
    }
  });

  // Get detailed monthly data for a specific student and month
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
        {
          $match: { teacher_id: teacher_id },
        },
        {
          $addFields: {
            student_id_obj: { $toObjectId: "$student_id" },
            subject_id_obj: { $toObjectId: "$subject_id" },
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
        {
          $addFields: {
            student_name: "$student_info.name",
          },
        },
        // Lookup subject info
        {
          $lookup: {
            from: "subjects",
            localField: "subject_id_obj",
            foreignField: "_id",
            as: "subject_info",
          },
        },
        { $unwind: "$subject_info" },
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
        // Group by student, subject, month and year
        {
          $group: {
            _id: {
              student_id: "$student_id",
              student_name: "$student_name",
              subject_id: "$subject_id",
              subject_name: "$subject_info.subject_name", // Include subject_name in grouping
              month: "$month",
              year: "$year",
            },
            entries: {
              $push: {
                _id: "$_id",
                time_of_month: "$time_of_month",
                book_name: "$book_name",
                qaidahPages: "$qaidahPages",
                duasSurahs: "$duasSurahs",
                islamicStudiesPages: "$islamicStudiesPages",
                description: "$description",
                date: "$date",
              },
            },
          },
        },
        // Sort entries by time_of_month (beginning first)
        {
          $addFields: {
            entries: {
              $sortArray: {
                input: "$entries",
                sortBy: { time_of_month: 1 },
              },
            },
          },
        },
        // Final projection
        {
          $project: {
            _id: 0,
            student_id: "$_id.student_id",
            student_name: "$_id.student_name",
            subject_id: "$_id.subject_id",
            subject_name: "$_id.subject_name", // Subject name at root level
            month: "$_id.month",
            year: "$_id.year",
            entries: 1,
          },
        },
        // Sort by student name, subject, year and month
        {
          $sort: {
            student_name: 1,
            subject_name: 1,
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
      console.error("Error in teacher-students-progress:", error);
      res.status(500).send({ error: "Internal server error" });
    }
  });

  router.put("/:id", async (req, res) => {
    const id = req.params.id;
    const updatedLesson = req.body;

    try {
      // Remove _id before update
      delete updatedLesson._id;
      const result = await lessonsCoveredCollection.updateOne(
        { _id: new ObjectId(id) }, // ✅ Important: Convert to ObjectId
        { $set: updatedLesson }
      );

      res.send(result);
    } catch (error) {
      console.error("Update Error:", error); // ✅ Log the error for debugging
      res.status(500).send({ error: "Update failed" });
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
