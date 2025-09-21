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
            (subj) => !beginningSubjects.includes(subj)
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

      // ✅ Restrict page number lower than last record
      const lastLessons = await lessonsCoveredCollection
        .find({ student_id })
        .sort({ year: -1, month: -1, time_of_month: -1 })
        .limit(2)
        .toArray();

      if (lastLessons.length > 0) {
        // Find the most recent ending report or the most recent report if no ending exists
        let lastLessonWithEnding = lastLessons.find(
          (lesson) => lesson.time_of_month === "ending"
        );
        let prevLesson = lastLessonWithEnding || lastLessons[0];

        const wrongSubjects = [];

        // Compare page numbers for each subject
        for (const subjectKey of Object.keys(lessons)) {
          if (prevLesson.lessons && prevLesson.lessons[subjectKey]) {
            let newPage, prevPage;

            // Handle different subject structures
            if (subjectKey === "qaidah_quran" && lessons[subjectKey].data) {
              newPage = parseInt(lessons[subjectKey].data.page || 0);
              prevPage = parseInt(
                prevLesson.lessons[subjectKey].data?.page || 0
              );
            } else {
              newPage = parseInt(lessons[subjectKey].page || 0);
              prevPage = parseInt(prevLesson.lessons[subjectKey].page || 0);
            }

            if (newPage < prevPage) {
              wrongSubjects.push({
                subject: subjectKey,
                prevPage: prevPage,
                newPage: newPage,
              });
            }
          }
        }

        if (wrongSubjects.length > 0) {
          return res.status(400).send({
            message:
              "Some subjects have lower page numbers than previous report.",
            details: wrongSubjects,
          });
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
      res.status(500).send({ error: "Internal server error" });
    }
  });

  // Teacher monthly progress - UPDATED with gift_for_muslim support
  router.get("/teacher-monthly-summary/:teacher_id", async (req, res) => {
    try {
      const { teacher_id } = req.params;
      const { month, year } = req.query;

      // Create match conditions - only unpublished monthly reports
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

        // Convert string IDs to ObjectId
        {
          $addFields: {
            student_id: { $toObjectId: "$student_id" },
            class_id: { $toObjectId: "$class_id" },
            teacher_id: { $toObjectId: "$teacher_id" },
            department_id: { $toObjectId: "$department_id" },
            original_id: { $toString: "$_id" },
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
                lessons: "$lessons",
                original_id: "$original_id",
                monthly_publish: "$monthly_publish",
                type: "$type", // Include type in grouping
              },
            },
            class_id: { $first: "$class_id" },
            teacher_id: { $first: "$teacher_id" },
            department_id: { $first: "$department_id" },
            all_published: { $min: "$monthly_publish" },
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
            class_id: 1,
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

        // Calculate progress for each lesson type with proper null handling
        {
          $project: {
            student_id: 1,
            month: 1,
            year: 1,
            class_id: 1,
            teacher_id: 1,
            department_id: 1,

            // Determine type (use ending type if available, otherwise beginning)
            type: {
              $cond: [
                { $ne: ["$ending.type", null] },
                "$ending.type",
                "$beginning.type",
              ],
            },

            // Qaidah/Quran progress
            qaidah_quran_progress: {
              $cond: [
                {
                  $and: [
                    "$beginning",
                    "$ending",
                    "$beginning.lessons",
                    "$ending.lessons",
                    "$beginning.lessons.qaidah_quran",
                    "$ending.lessons.qaidah_quran",
                  ],
                },
                {
                  page_progress: {
                    $subtract: [
                      {
                        $ifNull: [
                          { $toInt: "$ending.lessons.qaidah_quran.data.page" },
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          {
                            $toInt: "$beginning.lessons.qaidah_quran.data.page",
                          },
                          0,
                        ],
                      },
                    ],
                  },
                  line_progress: {
                    $subtract: [
                      {
                        $ifNull: [
                          { $toInt: "$ending.lessons.qaidah_quran.data.line" },
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          {
                            $toInt: "$beginning.lessons.qaidah_quran.data.line",
                          },
                          0,
                        ],
                      },
                    ],
                  },
                  level_display: {
                    $cond: [
                      {
                        $and: [
                          "$beginning.lessons.qaidah_quran.data.level",
                          "$ending.lessons.qaidah_quran.data.level",
                        ],
                      },
                      {
                        $concat: [
                          {
                            $ifNull: [
                              "$beginning.lessons.qaidah_quran.data.level",
                              "N/A",
                            ],
                          },
                          " - ",
                          {
                            $ifNull: [
                              "$ending.lessons.qaidah_quran.data.level",
                              "N/A",
                            ],
                          },
                        ],
                      },
                      "N/A",
                    ],
                  },
                  lesson_name_display: {
                    $cond: [
                      {
                        $and: [
                          "$beginning.lessons.qaidah_quran.data.lesson_name",
                          "$ending.lessons.qaidah_quran.data.lesson_name",
                        ],
                      },
                      {
                        $concat: [
                          {
                            $ifNull: [
                              "$beginning.lessons.qaidah_quran.data.lesson_name",
                              "N/A",
                            ],
                          },
                          " - ",
                          {
                            $ifNull: [
                              "$ending.lessons.qaidah_quran.data.lesson_name",
                              "N/A",
                            ],
                          },
                        ],
                      },
                      "N/A",
                    ],
                  },
                  selected: "$ending.lessons.qaidah_quran.selected",
                },
                null,
              ],
            },

            // Islamic Studies progress (only for normal type)
            islamic_studies_progress: {
              $cond: [
                {
                  $and: [
                    "$beginning",
                    "$ending",
                    "$beginning.lessons",
                    "$ending.lessons",
                    "$beginning.lessons.islamic_studies",
                    "$ending.lessons.islamic_studies",
                    { $ne: ["$ending.type", "gift_muslim"] }, // Only for normal type
                  ],
                },
                {
                  page_progress: {
                    $subtract: [
                      {
                        $ifNull: [
                          { $toInt: "$ending.lessons.islamic_studies.page" },
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          { $toInt: "$beginning.lessons.islamic_studies.page" },
                          0,
                        ],
                      },
                    ],
                  },
                  book_display: {
                    $cond: [
                      {
                        $and: [
                          "$beginning.lessons.islamic_studies.book",
                          "$ending.lessons.islamic_studies.book",
                        ],
                      },
                      {
                        $concat: [
                          {
                            $ifNull: [
                              "$beginning.lessons.islamic_studies.book",
                              "N/A",
                            ],
                          },
                          " - ",
                          {
                            $ifNull: [
                              "$ending.lessons.islamic_studies.book",
                              "N/A",
                            ],
                          },
                        ],
                      },
                      "N/A",
                    ],
                  },
                  lesson_name_display: {
                    $cond: [
                      {
                        $and: [
                          "$beginning.lessons.islamic_studies.lesson_name",
                          "$ending.lessons.islamic_studies.lesson_name",
                        ],
                      },
                      {
                        $concat: [
                          {
                            $ifNull: [
                              "$beginning.lessons.islamic_studies.lesson_name",
                              "N/A",
                            ],
                          },
                          " - ",
                          {
                            $ifNull: [
                              "$ending.lessons.islamic_studies.lesson_name",
                              "N/A",
                            ],
                          },
                        ],
                      },
                      "N/A",
                    ],
                  },
                },
                null,
              ],
            },

            // Dua/Surah progress (only for normal type)
            dua_surah_progress: {
              $cond: [
                {
                  $and: [
                    "$beginning",
                    "$ending",
                    "$beginning.lessons",
                    "$ending.lessons",
                    "$beginning.lessons.dua_surah",
                    "$ending.lessons.dua_surah",
                    { $ne: ["$ending.type", "gift_muslim"] }, // Only for normal type
                  ],
                },
                {
                  page_progress: {
                    $subtract: [
                      {
                        $ifNull: [
                          { $toInt: "$ending.lessons.dua_surah.page" },
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          { $toInt: "$beginning.lessons.dua_surah.page" },
                          0,
                        ],
                      },
                    ],
                  },
                  target_progress: {
                    $subtract: [
                      {
                        $ifNull: [
                          { $toInt: "$ending.lessons.dua_surah.target" },
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          { $toInt: "$beginning.lessons.dua_surah.target" },
                          0,
                        ],
                      },
                    ],
                  },
                  dua_number_progress: {
                    $subtract: [
                      {
                        $ifNull: [
                          { $toInt: "$ending.lessons.dua_surah.dua_number" },
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          { $toInt: "$beginning.lessons.dua_surah.dua_number" },
                          0,
                        ],
                      },
                    ],
                  },
                  book_display: {
                    $cond: [
                      {
                        $and: [
                          "$beginning.lessons.dua_surah.book",
                          "$ending.lessons.dua_surah.book",
                        ],
                      },
                      {
                        $concat: [
                          {
                            $ifNull: [
                              "$beginning.lessons.dua_surah.book",
                              "N/A",
                            ],
                          },
                          " - ",
                          {
                            $ifNull: ["$ending.lessons.dua_surah.book", "N/A"],
                          },
                        ],
                      },
                      "N/A",
                    ],
                  },
                  level_display: {
                    $cond: [
                      {
                        $and: [
                          "$beginning.lessons.dua_surah.level",
                          "$ending.lessons.dua_surah.level",
                        ],
                      },
                      {
                        $concat: [
                          {
                            $ifNull: [
                              "$beginning.lessons.dua_surah.level",
                              "N/A",
                            ],
                          },
                          " - ",
                          {
                            $ifNull: ["$ending.lessons.dua_surah.level", "N/A"],
                          },
                        ],
                      },
                      "N/A",
                    ],
                  },
                  lesson_name_display: {
                    $cond: [
                      {
                        $and: [
                          "$beginning.lessons.dua_surah.lesson_name",
                          "$ending.lessons.dua_surah.lesson_name",
                        ],
                      },
                      {
                        $concat: [
                          {
                            $ifNull: [
                              "$beginning.lessons.dua_surah.lesson_name",
                              "N/A",
                            ],
                          },
                          " - ",
                          {
                            $ifNull: [
                              "$ending.lessons.dua_surah.lesson_name",
                              "N/A",
                            ],
                          },
                        ],
                      },
                      "N/A",
                    ],
                  },
                },
                null,
              ],
            },

            // Gift for Muslim progress (only for gift_muslim type)
            gift_for_muslim_progress: {
              $cond: [
                {
                  $and: [
                    "$beginning",
                    "$ending",
                    "$beginning.lessons",
                    "$ending.lessons",
                    "$beginning.lessons.gift_for_muslim",
                    "$ending.lessons.gift_for_muslim",
                    { $eq: ["$ending.type", "gift_muslim"] }, // Only for gift_muslim type
                  ],
                },
                {
                  page_progress: {
                    $subtract: [
                      {
                        $ifNull: [
                          { $toInt: "$ending.lessons.gift_for_muslim.page" },
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          { $toInt: "$beginning.lessons.gift_for_muslim.page" },
                          0,
                        ],
                      },
                    ],
                  },
                  target_progress: {
                    $subtract: [
                      {
                        $ifNull: [
                          { $toInt: "$ending.lessons.gift_for_muslim.target" },
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          {
                            $toInt: "$beginning.lessons.gift_for_muslim.target",
                          },
                          0,
                        ],
                      },
                    ],
                  },
                  level_display: {
                    $cond: [
                      {
                        $and: [
                          "$beginning.lessons.gift_for_muslim.level",
                          "$ending.lessons.gift_for_muslim.level",
                        ],
                      },
                      {
                        $concat: [
                          {
                            $ifNull: [
                              "$beginning.lessons.gift_for_muslim.level",
                              "N/A",
                            ],
                          },
                          " - ",
                          {
                            $ifNull: [
                              "$ending.lessons.gift_for_muslim.level",
                              "N/A",
                            ],
                          },
                        ],
                      },
                      "N/A",
                    ],
                  },
                  lesson_name_display: {
                    $cond: [
                      {
                        $and: [
                          "$beginning.lessons.gift_for_muslim.lesson_name",
                          "$ending.lessons.gift_for_muslim.lesson_name",
                        ],
                      },
                      {
                        $concat: [
                          {
                            $ifNull: [
                              "$beginning.lessons.gift_for_muslim.lesson_name",
                              "N/A",
                            ],
                          },
                          " - ",
                          {
                            $ifNull: [
                              "$ending.lessons.gift_for_muslim.lesson_name",
                              "N/A",
                            ],
                          },
                        ],
                      },
                      "N/A",
                    ],
                  },
                },
                null,
              ],
            },

            hasBeginning: { $ne: ["$beginning", null] },
            hasEnding: true,

            // Collect document IDs
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
            isUnpublished: { $literal: true },
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

        // Final projection
        {
          $project: {
            student_id: 1,
            student_name: "$student_info.name",
            processedDocumentIds: 1,
            teacher_id: 1,
            month: 1,
            year: 1,
            type: 1,
            class_name: "$class_info.class_name",
            qaidah_quran_progress: 1,
            islamic_studies_progress: 1,
            dua_surah_progress: 1,
            gift_for_muslim_progress: 1,
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
      console.error("Monthly summary error:", error);
      res.status(500).send({
        error: "Internal server error",
        details: error.message,
      });
    }
  });

  // Teacher yearly progress - UPDATED with gift_for_muslim support
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
            teacher_id: { $toObjectId: "$teacher_id" },
          },
        },
        {
          $group: {
            _id: {
              student_id: "$student_id",
              month: "$month",
              class_id: "$class_id",
            },
            entries: {
              $push: {
                time_of_month: "$time_of_month",
                lessons: "$lessons",
                type: "$type", // Include type in grouping
              },
            },
            document_ids: { $addToSet: "$_id" },
          },
        },
        {
          $project: {
            _id: 0,
            student_id: "$_id.student_id",
            month: "$_id.month",
            class_id: "$_id.class_id",
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
            document_ids: 1,
            type: {
              $cond: [
                { $ne: ["$ending.type", null] },
                "$ending.type",
                "$beginning.type",
              ],
            },

            // Calculate monthly progress for each lesson type with proper null handling
            qaidah_quran_monthly: {
              $cond: [
                {
                  $and: [
                    "$beginning",
                    "$ending",
                    "$beginning.lessons",
                    "$ending.lessons",
                    "$beginning.lessons.qaidah_quran",
                    "$ending.lessons.qaidah_quran",
                  ],
                },
                {
                  page_progress: {
                    $subtract: [
                      {
                        $ifNull: [
                          { $toInt: "$ending.lessons.qaidah_quran.data.page" },
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          {
                            $toInt: "$beginning.lessons.qaidah_quran.data.page",
                          },
                          0,
                        ],
                      },
                    ],
                  },
                  line_progress: {
                    $subtract: [
                      {
                        $ifNull: [
                          { $toInt: "$ending.lessons.qaidah_quran.data.line" },
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          {
                            $toInt: "$beginning.lessons.qaidah_quran.data.line",
                          },
                          0,
                        ],
                      },
                    ],
                  },
                },
                { page_progress: 0, line_progress: 0 },
              ],
            },

            islamic_studies_monthly: {
              $cond: [
                {
                  $and: [
                    "$beginning",
                    "$ending",
                    "$beginning.lessons",
                    "$ending.lessons",
                    "$beginning.lessons.islamic_studies",
                    "$ending.lessons.islamic_studies",
                    { $ne: ["$ending.type", "gift_muslim"] }, // Only for normal type
                  ],
                },
                {
                  page_progress: {
                    $subtract: [
                      {
                        $ifNull: [
                          { $toInt: "$ending.lessons.islamic_studies.page" },
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          { $toInt: "$beginning.lessons.islamic_studies.page" },
                          0,
                        ],
                      },
                    ],
                  },
                },
                { page_progress: 0 },
              ],
            },

            dua_surah_monthly: {
              $cond: [
                {
                  $and: [
                    "$beginning",
                    "$ending",
                    "$beginning.lessons",
                    "$ending.lessons",
                    "$beginning.lessons.dua_surah",
                    "$ending.lessons.dua_surah",
                    { $ne: ["$ending.type", "gift_muslim"] }, // Only for normal type
                  ],
                },
                {
                  page_progress: {
                    $subtract: [
                      {
                        $ifNull: [
                          { $toInt: "$ending.lessons.dua_surah.page" },
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          { $toInt: "$beginning.lessons.dua_surah.page" },
                          0,
                        ],
                      },
                    ],
                  },
                  target_progress: {
                    $subtract: [
                      {
                        $ifNull: [
                          { $toInt: "$ending.lessons.dua_surah.target" },
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          { $toInt: "$beginning.lessons.dua_surah.target" },
                          0,
                        ],
                      },
                    ],
                  },
                  dua_number_progress: {
                    $subtract: [
                      {
                        $ifNull: [
                          { $toInt: "$ending.lessons.dua_surah.dua_number" },
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          { $toInt: "$beginning.lessons.dua_surah.dua_number" },
                          0,
                        ],
                      },
                    ],
                  },
                },
                {
                  page_progress: 0,
                  target_progress: 0,
                  dua_number_progress: 0,
                },
              ],
            },

            gift_for_muslim_monthly: {
              $cond: [
                {
                  $and: [
                    "$beginning",
                    "$ending",
                    "$beginning.lessons",
                    "$ending.lessons",
                    "$beginning.lessons.gift_for_muslim",
                    "$ending.lessons.gift_for_muslim",
                    { $eq: ["$ending.type", "gift_muslim"] }, // Only for gift_muslim type
                  ],
                },
                {
                  page_progress: {
                    $subtract: [
                      {
                        $ifNull: [
                          { $toInt: "$ending.lessons.gift_for_muslim.page" },
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          { $toInt: "$beginning.lessons.gift_for_muslim.page" },
                          0,
                        ],
                      },
                    ],
                  },
                  target_progress: {
                    $subtract: [
                      {
                        $ifNull: [
                          { $toInt: "$ending.lessons.gift_for_muslim.target" },
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          {
                            $toInt: "$beginning.lessons.gift_for_muslim.target",
                          },
                          0,
                        ],
                      },
                    ],
                  },
                },
                {
                  page_progress: 0,
                  target_progress: 0,
                },
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
              type: "$type", // Group by type as well
              year: { $literal: parseInt(year) },
            },
            processedDocumentIds: { $addToSet: "$document_ids" },

            // Sum up yearly progress for each field
            qaidah_quran_yearly: {
              $sum: "$qaidah_quran_monthly.page_progress",
            },
            qaidah_quran_lines_yearly: {
              $sum: "$qaidah_quran_monthly.line_progress",
            },

            islamic_studies_yearly: {
              $sum: "$islamic_studies_monthly.page_progress",
            },

            dua_surah_pages_yearly: {
              $sum: "$dua_surah_monthly.page_progress",
            },
            dua_surah_targets_yearly: {
              $sum: "$dua_surah_monthly.target_progress",
            },
            dua_surah_numbers_yearly: {
              $sum: "$dua_surah_monthly.dua_number_progress",
            },

            gift_for_muslim_pages_yearly: {
              $sum: "$gift_for_muslim_monthly.page_progress",
            },
            gift_for_muslim_targets_yearly: {
              $sum: "$gift_for_muslim_monthly.target_progress",
            },

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
            type: "$_id.type",
            year: "$_id.year",
            processedDocumentIds: {
              $reduce: {
                input: "$processedDocumentIds",
                initialValue: [],
                in: { $setUnion: ["$$value", "$$this"] },
              },
            },
            qaidah_quran_yearly: 1,
            qaidah_quran_lines_yearly: 1,
            islamic_studies_yearly: 1,
            dua_surah_pages_yearly: 1,
            dua_surah_targets_yearly: 1,
            dua_surah_numbers_yearly: 1,
            gift_for_muslim_pages_yearly: 1,
            gift_for_muslim_targets_yearly: 1,
            months_with_ending: 1,
            months_with_both: 1,
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
          $project: {
            student_id: 1,
            student_name: "$student_info.name",
            year: 1,
            type: 1,
            processedDocumentIds: 1,
            class_name: "$class_info.class_name",
            qaidah_quran_yearly: 1,
            qaidah_quran_lines_yearly: 1,
            islamic_studies_yearly: 1,
            dua_surah_pages_yearly: 1,
            dua_surah_targets_yearly: 1,
            dua_surah_numbers_yearly: 1,
            gift_for_muslim_pages_yearly: 1,
            gift_for_muslim_targets_yearly: 1,
            months_with_ending: 1,
            months_with_both: 1,
          },
        },
      ];

      const result = await lessonsCoveredCollection
        .aggregate(pipeline)
        .toArray();
      return res.status(200).json(Array.isArray(result) ? result : []);
    } catch (error) {
      console.error("Yearly summary error:", error);
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

      // ✅ Page number restriction (only if lessons are being updated)
      if (lessons) {
        // Find the most recent previous record (excluding current document)
        const previousRecords = await lessonsCoveredCollection
          .find({
            student_id: existingLesson.student_id,
            _id: { $ne: new ObjectId(id) },
            $or: [
              { year: { $lt: existingLesson.year } },
              {
                year: existingLesson.year,
                month: { $lt: existingLesson.month },
              },
              {
                year: existingLesson.year,
                month: existingLesson.month,
                time_of_month: { $lt: existingLesson.time_of_month },
              },
            ],
          })
          .sort({ year: -1, month: -1, time_of_month: -1 })
          .limit(1)
          .toArray();

        // Only validate if there are previous records
        if (previousRecords.length > 0) {
          const prevLesson = previousRecords[0];
          const wrongSubjects = [];

          // Compare page numbers for each subject
          for (const subjectKey of Object.keys(lessons)) {
            if (prevLesson.lessons && prevLesson.lessons[subjectKey]) {
              let newPage, prevPage;

              // Handle different subject structures
              if (subjectKey === "qaidah_quran" && lessons[subjectKey].data) {
                newPage = parseInt(lessons[subjectKey].data.page || 0);
                prevPage = parseInt(
                  prevLesson.lessons[subjectKey].data?.page || 0
                );
              } else {
                newPage = parseInt(lessons[subjectKey].page || 0);
                prevPage = parseInt(prevLesson.lessons[subjectKey].page || 0);
              }

              if (newPage < prevPage) {
                wrongSubjects.push({
                  subject: subjectKey,
                  prevPage: prevPage,
                  newPage: newPage,
                });
              }
            }
          }

          if (wrongSubjects.length > 0) {
            return res.status(400).send({
              message:
                "Some subjects have lower page numbers than previous report.",
              details: wrongSubjects,
            });
          }
        }
      }

      // Update the document
      const result = await lessonsCoveredCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedData }
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
        }
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
