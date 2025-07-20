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
      const matchConditions = {
        $and: [
          {
            $or: [
              { monthly_publish: false },
              { monthly_publish: { $exists: false } },
            ],
          },
          ...(year ? [{ year }] : []),
          ...(month ? [{ month }] : []),
        ],
      };

      const pipeline = [
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

        // Group by student, month, and year
        {
          $group: {
            _id: {
              student_id: "$student_id",
              month: "$month",
              year: "$year",
              subject_id: "$subject_id",
            },
            entries: {
              $push: {
                time_of_month: "$time_of_month",
                qaidahPages: "$qaidahPages",
                duasSurahs: "$duasSurahs",
                islamicStudiesPages: "$islamicStudiesPages",
                original_id: "$_id", // Preserve original document ID
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
            entries: 1,
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

        // Calculate progress and collect document IDs
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
                { $toInt: "$ending.qaidahPages" },
                { $ifNull: [{ $toInt: "$beginning.qaidahPages" }, 0] },
              ],
            },
            duasSurahsProgress: {
              $subtract: [
                { $toInt: "$ending.duasSurahs" },
                { $ifNull: [{ $toInt: "$beginning.duasSurahs" }, 0] },
              ],
            },
            islamicStudiesProgress: {
              $subtract: [
                { $toInt: "$ending.islamicStudiesPages" },
                { $ifNull: [{ $toInt: "$beginning.islamicStudiesPages" }, 0] },
              ],
            },
            hasBeginning: { $ne: ["$beginning", null] },
            hasEnding: true,
            // Only include ending ID if no beginning exists
            processedDocumentIds: {
              $cond: [
                { $not: ["$beginning"] },
                [{ $toString: "$ending.original_id" }],
                {
                  $filter: {
                    input: [
                      { $toString: "$beginning.original_id" },
                      { $toString: "$ending.original_id" },
                    ],
                    as: "id",
                    cond: { $ne: ["$$id", null] },
                  },
                },
              ],
            },
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
            processedDocumentIds: 1,
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
        {
          $match: {
            year,
            $or: [
              { yearly_publish: false },
              { yearly_publish: { $exists: false } },
            ],
          },
        },

        {
          $addFields: {
            student_id: { $toObjectId: "$student_id" },
            class_id: { $toObjectId: "$class_id" },
            subject_id: { $toObjectId: "$subject_id" },
            teacher_id: { $toObjectId: "$teacher_id" },
          },
        },
        {
          $group: {
            _id: {
              student_id: "$student_id",
              month: "$month",
              class_id: "$class_id",
              subject_id: "$subject_id",
            },
            original_ids: { $addToSet: "$_id" },
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
        {
          $project: {
            _id: 0,
            student_id: "$_id.student_id",
            month: "$_id.month",
            class_id: "$_id.class_id",
            subject_id: "$_id.subject_id",
            book_names: 1,
            original_ids: 1,
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
        {
          $match: {
            ending: { $ne: null },
          },
        },
        {
          $project: {
            student_id: 1,
            month: 1,
            class_id: 1,
            subject_id: 1,
            book_names: 1,
            original_ids: 1,
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
        {
          $group: {
            _id: {
              student_id: "$student_id",
              class_id: "$class_id",
              subject_id: "$subject_id",
            },
            book_names: { $addToSet: "$book_names" },
            qaidahYearlyProgress: { $sum: "$qaidahProgress" },
            duasSurahsYearlyProgress: { $sum: "$duasSurahsProgress" },
            islamicStudiesYearlyProgress: { $sum: "$islamicStudiesProgress" },
            months_with_ending: { $sum: 1 },
            months_with_both: {
              $sum: {
                $cond: [{ $eq: ["$hasBeginning", true] }, 1, 0],
              },
            },
            allOriginalIds: { $push: "$original_ids" }, // array of arrays
          },
        },
        {
          $addFields: {
            processedDocumentIds: {
              $map: {
                input: {
                  $reduce: {
                    input: "$allOriginalIds",
                    initialValue: [],
                    in: { $concatArrays: ["$$value", "$$this"] },
                  },
                },
                as: "id",
                in: { $toString: "$$id" },
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            student_id: "$_id.student_id",
            class_id: "$_id.class_id",
            subject_id: "$_id.subject_id",
            book_names: {
              $reduce: {
                input: "$book_names",
                initialValue: [],
                in: { $setUnion: ["$$value", "$$this"] },
              },
            },
            qaidahYearlyProgress: 1,
            duasSurahsYearlyProgress: 1,
            islamicStudiesYearlyProgress: 1,
            months_with_ending: 1,
            months_with_both: 1,
            processedDocumentIds: 1,
            year: parseInt(year),
          },
        },
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
          $project: {
            student_id: 1,
            student_name: "$student_info.name",
            class_name: "$class_info.class_name",
            subject_name: "$subject_info.subject_name",
            book_names: 1,
            qaidahYearlyProgress: 1,
            duasSurahsYearlyProgress: 1,
            islamicStudiesYearlyProgress: 1,
            months_with_ending: 1,
            months_with_both: 1,
            processedDocumentIds: 1,
            year: { $literal: parseInt(year) }, // ✅ This fixes the missing field
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

      // Create match conditions - always filter by teacher_id and monthly_publish: false
      const matchConditions = {
        teacher_id: teacher_id,
        monthly_publish: false,
      };

      if (year) matchConditions.year = year;
      if (month) matchConditions.month = month;

      const pipeline = [
        // Initial match stage with all conditions
        {
          $match: matchConditions,
        },

        // Convert string IDs to ObjectId and preserve original _id
        {
          $addFields: {
            student_id: { $toObjectId: "$student_id" },
            class_id: { $toObjectId: "$class_id" },
            subject_id: { $toObjectId: "$subject_id" },
            teacher_id: { $toObjectId: "$teacher_id" },
            department_id: { $toObjectId: "$department_id" },
            original_id: { $toString: "$_id" }, // Preserve original document ID
          },
        },

        // Group by student, month, and year
        {
          $group: {
            _id: {
              student_id: "$student_id",
              month: "$month",
              year: "$year",
            },
            entries: {
              $push: {
                time_of_month: "$time_of_month",
                qaidahPages: "$qaidahPages",
                duasSurahs: "$duasSurahs",
                islamicStudiesPages: "$islamicStudiesPages",
                original_id: "$original_id",
                monthly_publish: "$monthly_publish",
              },
            },
            book_names: { $addToSet: "$book_name" },
            class_id: { $first: "$class_id" },
            subject_id: { $first: "$subject_id" },
            teacher_id: { $first: "$teacher_id" },
            department_id: { $first: "$department_id" },
            all_published: { $min: "$monthly_publish" }, // Check if any entry is unpublished
          },
        },

        // Ensure we only include groups with unpublished entries
        {
          $match: {
            all_published: false,
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
            entries: 1,
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

        // Calculate progress and collect document IDs
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
                { $toInt: "$ending.qaidahPages" },
                { $ifNull: [{ $toInt: "$beginning.qaidahPages" }, 0] },
              ],
            },
            duasSurahsProgress: {
              $subtract: [
                { $toInt: "$ending.duasSurahs" },
                { $ifNull: [{ $toInt: "$beginning.duasSurahs" }, 0] },
              ],
            },
            islamicStudiesProgress: {
              $subtract: [
                { $toInt: "$ending.islamicStudiesPages" },
                { $ifNull: [{ $toInt: "$beginning.islamicStudiesPages" }, 0] },
              ],
            },
            hasBeginning: { $ne: ["$beginning", null] },
            hasEnding: true,
            // Collect document IDs properly
            processedDocumentIds: {
              $cond: [
                { $not: ["$beginning"] },
                [{ $toString: "$ending.original_id" }],
                {
                  $filter: {
                    input: [
                      { $toString: "$beginning.original_id" },
                      { $toString: "$ending.original_id" },
                    ],
                    as: "id",
                    cond: { $ne: ["$$id", null] },
                  },
                },
              ],
            },
            isUnpublished: { $literal: true }, // Mark as unpublished
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
            processedDocumentIds: 1,
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
            isUnpublished: 1,
          },
        },
      ];

      const result = await lessonsCoveredCollection
        .aggregate(pipeline)
        .toArray();
      res.send(result.length > 0 ? result : []);
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
        {
          $match: {
            teacher_id: teacher_id,
            year: year,
            $or: [
              { yearly_publish: { $exists: false } },
              { yearly_publish: false },
            ],
          },
        },
        {
          $addFields: {
            student_id: { $toObjectId: "$student_id" },
            class_id: { $toObjectId: "$class_id" },
            subject_id: { $toObjectId: "$subject_id" },
            teacher_id: { $toObjectId: "$teacher_id" },
          },
        },
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
            document_ids: { $addToSet: "$_id" }, // collect unpublished document IDs
          },
        },
        {
          $project: {
            _id: 0,
            student_id: "$_id.student_id",
            month: "$_id.month",
            class_id: "$_id.class_id",
            subject_id: "$_id.subject_id",
            book_names: 1,
            document_ids: 1,
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
        {
          $match: {
            ending: { $ne: null },
          },
        },
        {
          $project: {
            student_id: 1,
            month: 1,
            class_id: 1,
            subject_id: 1,
            book_names: 1,
            document_ids: 1,
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
        {
          $group: {
            _id: {
              student_id: "$student_id",
              class_id: "$class_id",
              subject_id: "$subject_id",
            },
            book_names: { $addToSet: "$book_names" },
            processedDocumentIds: { $addToSet: "$document_ids" },
            qaidahYearlyProgress: { $sum: "$qaidahProgress" },
            duasSurahsYearlyProgress: { $sum: "$duasSurahsProgress" },
            islamicStudiesYearlyProgress: { $sum: "$islamicStudiesProgress" },
            months_with_ending: { $sum: 1 },
            months_with_both: {
              $sum: {
                $cond: [{ $eq: ["$hasBeginning", true] }, 1, 0],
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            student_id: "$_id.student_id",
            class_id: "$_id.class_id",
            subject_id: "$_id.subject_id",
            book_names: {
              $reduce: {
                input: "$book_names",
                initialValue: [],
                in: { $setUnion: ["$$value", "$$this"] }, // flatten nested arrays
              },
            },
            processedDocumentIds: {
              $reduce: {
                input: "$processedDocumentIds",
                initialValue: [],
                in: { $setUnion: ["$$value", "$$this"] },
              },
            },
            qaidahYearlyProgress: 1,
            duasSurahsYearlyProgress: 1,
            islamicStudiesYearlyProgress: 1,
            months_with_ending: 1,
            months_with_both: 1,
            year: parseInt(year),
          },
        },
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
          $project: {
            student_id: 1,
            student_name: "$student_info.name",
            year: 1,
            processedDocumentIds: 1,
            book_names: 1,
            class_name: "$class_info.class_name",
            subject_name: "$subject_info.subject_name",
            qaidahYearlyProgress: 1,
            duasSurahsYearlyProgress: 1,
            islamicStudiesYearlyProgress: 1,
            months_with_ending: 1,
            months_with_both: 1,
            year: { $literal: parseInt(year) }, // ✅ This fixes the missing field
          },
        },
      ];

      const result = await lessonsCoveredCollection
        .aggregate(pipeline)
        .toArray();

      return res.status(200).json(Array.isArray(result) ? result : []);
    } catch (error) {
      console.error("Error:", error);
      return res.status(200).json([]);
    }
  });

  // student monthly summary
  router.get("/student-monthly-summary", async (req, res) => {
    try {
      const { month, year, student_ids } = req.query;

      if (!year || !student_ids) {
        return res.status(400).send({
          error: "year and student_ids parameters are required",
        });
      }

      // Convert comma-separated string to array
      const studentIdsArray = student_ids.split(",");
      const matchStage = {
        $match: {
          student_id: { $in: studentIdsArray },
          year: year,
          monthly_publish: true,
          ...(month && { month }), // Only include month filter if it's provided
        },
      };

      const pipeline = [
        matchStage,
        {
          $addFields: {
            student_id: { $toObjectId: "$student_id" },
            class_id: { $toObjectId: "$class_id" },
            subject_id: { $toObjectId: "$subject_id" },
            original_id: { $toString: "$_id" },
          },
        },
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
                original_id: "$original_id",
              },
            },
            book_names: { $addToSet: "$book_name" },
          },
        },
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
            documentIds: "$entries.original_id",
          },
        },
        {
          $match: {
            ending: { $ne: null },
          },
        },
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
            processedDocumentIds: "$documentIds",
          },
        },
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
          $project: {
            student_id: 1,
            student_name: "$student_info.name",
            month: 1,
            year: { $literal: parseInt(year) },
            book_names: 1,
            class_name: "$class_info.class_name",
            subject_name: "$subject_info.subject_name",
            qaidahProgress: 1,
            duasSurahsProgress: 1,
            islamicStudiesProgress: 1,
            hasBeginning: 1,
            processedDocumentIds: 1,
            isPublished: { $literal: true },
          },
        },
      ];

      const result = await lessonsCoveredCollection
        .aggregate(pipeline)
        .toArray();
      res.send(result.length > 0 ? result : []);
    } catch (error) {
      console.error("Error in student monthly-summary:", error);
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

      const pipeline = [
        {
          $match: {
            student_id: { $in: studentIdsArray },
            year: year,
            yearly_publish: true,
          },
        },
        {
          $addFields: {
            student_id: { $toObjectId: "$student_id" },
            class_id: { $toObjectId: "$class_id" },
            subject_id: { $toObjectId: "$subject_id" },
            original_id: { $toString: "$_id" },
          },
        },
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
                original_id: "$original_id",
              },
            },
            book_names: { $addToSet: "$book_name" },
          },
        },
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
            documentIds: "$entries.original_id",
          },
        },
        {
          $match: {
            ending: { $ne: null },
          },
        },
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
            documentIds: 1,
          },
        },
        {
          $group: {
            _id: {
              student_id: "$student_id",
              class_id: "$class_id",
              subject_id: "$subject_id",
            },
            book_names: { $addToSet: "$book_names" },
            processedDocumentIds: { $addToSet: "$documentIds" },
            qaidahYearlyProgress: { $sum: "$qaidahProgress" },
            duasSurahsYearlyProgress: { $sum: "$duasSurahsProgress" },
            islamicStudiesYearlyProgress: { $sum: "$islamicStudiesProgress" },
            months_with_ending: { $sum: 1 },
            months_with_both: {
              $sum: {
                $cond: [{ $eq: ["$hasBeginning", true] }, 1, 0],
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            student_id: "$_id.student_id",
            class_id: "$_id.class_id",
            subject_id: "$_id.subject_id",
            book_names: {
              $reduce: {
                input: "$book_names",
                initialValue: [],
                in: { $setUnion: ["$$value", "$$this"] },
              },
            },
            processedDocumentIds: {
              $reduce: {
                input: "$processedDocumentIds",
                initialValue: [],
                in: { $setUnion: ["$$value", "$$this"] },
              },
            },
            qaidahYearlyProgress: 1,
            duasSurahsYearlyProgress: 1,
            islamicStudiesYearlyProgress: 1,
            months_with_ending: 1,
            months_with_both: 1,
            year: parseInt(year),
          },
        },
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
          $project: {
            student_id: 1,
            student_name: "$student_info.name",
            year: 1,
            processedDocumentIds: 1,
            book_names: 1,
            class_name: "$class_info.class_name",
            subject_name: "$subject_info.subject_name",
            qaidahYearlyProgress: 1,
            duasSurahsYearlyProgress: 1,
            islamicStudiesYearlyProgress: 1,
            months_with_ending: 1,
            months_with_both: 1,
            isPublished: { $literal: true },
          },
        },
      ];

      const result = await lessonsCoveredCollection
        .aggregate(pipeline)
        .toArray();
      res.send(result.length > 0 ? result : []);
    } catch (error) {
      console.error("Error in student yearly-summary:", error);
      res.status(500).send({
        error: "Internal server error",
        details: error.message,
      });
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
        }
      );

      res.send({
        success: true,
        modifiedCount: result.modifiedCount,
        message: `${result.modifiedCount} records updated.`,
      });
    } catch (err) {
      console.error(err);
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
