const express = require("express");
const { messaging } = require("firebase-admin");
const router = express.Router();
const { ObjectId } = require("mongodb");

module.exports = (
  lessonsCoveredCollection,
  studentsCollection,
  teachersCollection
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
        `🔍 Looking for: ${prevMonth} ${prevYear} (previous to ${month} ${year})`
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
        `✅ Found previous data: ${previousEnding.month} ${previousEnding.year}`
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

      const pipeline = [
        // Initial match stage with all conditions
        {
          $match: matchConditions,
        },

        // Convert string IDs to ObjectId with empty string handling
        {
          $addFields: {
            student_id: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$student_id", ""] },
                    { $ne: ["$student_id", null] },
                  ],
                },
                { $toObjectId: "$student_id" },
                null,
              ],
            },
            class_id: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$class_id", ""] },
                    { $ne: ["$class_id", null] },
                  ],
                },
                { $toObjectId: "$class_id" },
                null,
              ],
            },
            teacher_id: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$teacher_id", ""] },
                    { $ne: ["$teacher_id", null] },
                  ],
                },
                { $toObjectId: "$teacher_id" },
                null,
              ],
            },
            department_id: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$department_id", ""] },
                    { $ne: ["$department_id", null] },
                  ],
                },
                { $toObjectId: "$department_id" },
                null,
              ],
            },
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
                type: "$type",
                teacher_id: "$teacher_id",
                class_id: "$class_id",
                department_id: "$department_id",
              },
            },
            // Get the first non-null values for these fields
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

        // Count beginning and ending entries
        {
          $addFields: {
            beginning_count: {
              $size: {
                $filter: {
                  input: "$entries",
                  as: "entry",
                  cond: { $eq: ["$$entry.time_of_month", "beginning"] },
                },
              },
            },
            ending_count: {
              $size: {
                $filter: {
                  input: "$entries",
                  as: "entry",
                  cond: { $eq: ["$$entry.time_of_month", "ending"] },
                },
              },
            },
          },
        },

        // Only include groups that have BOTH beginning AND ending entries
        {
          $match: {
            $and: [
              { beginning_count: { $gt: 0 } },
              { ending_count: { $gt: 0 } },
            ],
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

        // Calculate progress for each lesson type with SAFE number conversion
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
                  selected: "$ending.lessons.qaidah_quran.selected",
                  page_progress: {
                    $let: {
                      vars: {
                        startPage: {
                          $ifNull: [
                            {
                              $convert: {
                                input:
                                  "$beginning.lessons.qaidah_quran.data.page",
                                to: "double",
                                onError: 0,
                                onNull: 0,
                              },
                            },
                            0,
                          ],
                        },
                        endPage: {
                          $ifNull: [
                            {
                              $convert: {
                                input: "$ending.lessons.qaidah_quran.data.page",
                                to: "double",
                                onError: 0,
                                onNull: 0,
                              },
                            },
                            0,
                          ],
                        },
                      },
                      in: {
                        $subtract: ["$$endPage", "$$startPage"],
                      },
                    },
                  },
                  line_progress: {
                    $cond: [
                      {
                        $and: [
                          "$ending.lessons.qaidah_quran.data.line",
                          "$beginning.lessons.qaidah_quran.data.line",
                        ],
                      },
                      {
                        $let: {
                          vars: {
                            startLine: {
                              $ifNull: [
                                {
                                  $convert: {
                                    input:
                                      "$beginning.lessons.qaidah_quran.data.line",
                                    to: "double",
                                    onError: 0,
                                    onNull: 0,
                                  },
                                },
                                0,
                              ],
                            },
                            endLine: {
                              $ifNull: [
                                {
                                  $convert: {
                                    input:
                                      "$ending.lessons.qaidah_quran.data.line",
                                    to: "double",
                                    onError: 0,
                                    onNull: 0,
                                  },
                                },
                                0,
                              ],
                            },
                          },
                          in: {
                            $subtract: ["$$endLine", "$$startLine"],
                          },
                        },
                      },
                      null,
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
                    { $ne: ["$ending.type", "gift_muslim"] },
                  ],
                },
                {
                  page_progress: {
                    $subtract: [
                      {
                        $ifNull: [
                          {
                            $convert: {
                              input: {
                                $regexFind: {
                                  input: {
                                    $ifNull: [
                                      "$ending.lessons.islamic_studies.page",
                                      "0",
                                    ],
                                  },
                                  regex: /^(\d+)/,
                                },
                              },
                              to: "int",
                              onError: 0,
                              onNull: 0,
                            },
                          },
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          {
                            $convert: {
                              input: {
                                $regexFind: {
                                  input: {
                                    $ifNull: [
                                      "$beginning.lessons.islamic_studies.page",
                                      "0",
                                    ],
                                  },
                                  regex: /^(\d+)/,
                                },
                              },
                              to: "int",
                              onError: 0,
                              onNull: 0,
                            },
                          },
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
                    { $ne: ["$ending.type", "gift_muslim"] },
                  ],
                },
                {
                  page_progress: {
                    $subtract: [
                      {
                        $ifNull: [
                          {
                            $convert: {
                              input: {
                                $regexFind: {
                                  input: {
                                    $ifNull: [
                                      "$ending.lessons.dua_surah.page",
                                      "0",
                                    ],
                                  },
                                  regex: /^(\d+)/,
                                },
                              },
                              to: "int",
                              onError: 0,
                              onNull: 0,
                            },
                          },
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          {
                            $convert: {
                              input: {
                                $regexFind: {
                                  input: {
                                    $ifNull: [
                                      "$beginning.lessons.dua_surah.page",
                                      "0",
                                    ],
                                  },
                                  regex: /^(\d+)/,
                                },
                              },
                              to: "int",
                              onError: 0,
                              onNull: 0,
                            },
                          },
                          0,
                        ],
                      },
                    ],
                  },
                  target_progress: {
                    $subtract: [
                      {
                        $ifNull: [
                          {
                            $convert: {
                              input: {
                                $regexFind: {
                                  input: {
                                    $ifNull: [
                                      "$ending.lessons.dua_surah.target",
                                      "0",
                                    ],
                                  },
                                  regex: /^(\d+)/,
                                },
                              },
                              to: "int",
                              onError: 0,
                              onNull: 0,
                            },
                          },
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          {
                            $convert: {
                              input: {
                                $regexFind: {
                                  input: {
                                    $ifNull: [
                                      "$beginning.lessons.dua_surah.target",
                                      "0",
                                    ],
                                  },
                                  regex: /^(\d+)/,
                                },
                              },
                              to: "int",
                              onError: 0,
                              onNull: 0,
                            },
                          },
                          0,
                        ],
                      },
                    ],
                  },
                  dua_number_progress: {
                    $subtract: [
                      {
                        $ifNull: [
                          {
                            $convert: {
                              input: {
                                $regexFind: {
                                  input: {
                                    $ifNull: [
                                      "$ending.lessons.dua_surah.dua_number",
                                      "0",
                                    ],
                                  },
                                  regex: /^(\d+)/,
                                },
                              },
                              to: "int",
                              onError: 0,
                              onNull: 0,
                            },
                          },
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          {
                            $convert: {
                              input: {
                                $regexFind: {
                                  input: {
                                    $ifNull: [
                                      "$beginning.lessons.dua_surah.dua_number",
                                      "0",
                                    ],
                                  },
                                  regex: /^(\d+)/,
                                },
                              },
                              to: "int",
                              onError: 0,
                              onNull: 0,
                            },
                          },
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

            // Gift for Muslim progress (only for gift_muslim type) - ADDED THIS SECTION
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
                    { $eq: ["$ending.type", "gift_muslim"] },
                  ],
                },
                {
                  page_progress: {
                    $subtract: [
                      {
                        $ifNull: [
                          {
                            $convert: {
                              input: {
                                $regexFind: {
                                  input: {
                                    $ifNull: [
                                      "$ending.lessons.gift_for_muslim.page",
                                      "0",
                                    ],
                                  },
                                  regex: /^(\d+)/,
                                },
                              },
                              to: "int",
                              onError: 0,
                              onNull: 0,
                            },
                          },
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          {
                            $convert: {
                              input: {
                                $regexFind: {
                                  input: {
                                    $ifNull: [
                                      "$beginning.lessons.gift_for_muslim.page",
                                      "0",
                                    ],
                                  },
                                  regex: /^(\d+)/,
                                },
                              },
                              to: "int",
                              onError: 0,
                              onNull: 0,
                            },
                          },
                          0,
                        ],
                      },
                    ],
                  },
                  target_progress: {
                    $subtract: [
                      {
                        $ifNull: [
                          {
                            $convert: {
                              input: {
                                $regexFind: {
                                  input: {
                                    $ifNull: [
                                      "$ending.lessons.gift_for_muslim.target",
                                      "0",
                                    ],
                                  },
                                  regex: /^(\d+)/,
                                },
                              },
                              to: "int",
                              onError: 0,
                              onNull: 0,
                            },
                          },
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          {
                            $convert: {
                              input: {
                                $regexFind: {
                                  input: {
                                    $ifNull: [
                                      "$beginning.lessons.gift_for_muslim.target",
                                      "0",
                                    ],
                                  },
                                  regex: /^(\d+)/,
                                },
                              },
                              to: "int",
                              onError: 0,
                              onNull: 0,
                            },
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

            // Collect document IDs
            processedDocumentIds: {
              $filter: {
                input: [
                  { $toString: "$beginning.original_id" },
                  { $toString: "$ending.original_id" },
                ],
                as: "id",
                cond: { $ne: ["$$id", null] },
              },
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
            from: "teachers",
            localField: "teacher_id",
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

        // Final projection - Include gift_for_muslim_progress
        {
          $project: {
            student_name: "$student_info.name",
            teacher_name: "$teacher_info.name",
            class_name: "$class_info.class_name",
            month: 1,
            year: 1,
            type: 1,
            qaidah_quran_progress: 1,
            islamic_studies_progress: 1,
            dua_surah_progress: 1,
            gift_for_muslim_progress: 1, // ADDED THIS
            processedDocumentIds: 1,
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
            original_id: { $toString: "$_id" },
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
                type: "$type",
                original_id: "$original_id",
              },
            },
            document_ids: { $addToSet: "$original_id" },
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
        // CRITICAL FIX: Only include months that have BOTH beginning AND ending
        {
          $match: {
            $and: [{ beginning: { $ne: null } }, { ending: { $ne: null } }],
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
                  selected: "$ending.lessons.qaidah_quran.selected",
                  page_progress: {
                    $subtract: [
                      {
                        $ifNull: [
                          {
                            $convert: {
                              input: "$ending.lessons.qaidah_quran.data.page",
                              to: "int",
                              onError: 0,
                              onNull: 0,
                            },
                          },
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          {
                            $convert: {
                              input:
                                "$beginning.lessons.qaidah_quran.data.page",
                              to: "int",
                              onError: 0,
                              onNull: 0,
                            },
                          },
                          0,
                        ],
                      },
                    ],
                  },
                  line_progress: {
                    $cond: [
                      {
                        $and: [
                          "$ending.lessons.qaidah_quran.data.line",
                          "$beginning.lessons.qaidah_quran.data.line",
                        ],
                      },
                      {
                        $subtract: [
                          {
                            $ifNull: [
                              {
                                $convert: {
                                  input:
                                    "$ending.lessons.qaidah_quran.data.line",
                                  to: "int",
                                  onError: 0,
                                  onNull: 0,
                                },
                              },
                              0,
                            ],
                          },
                          {
                            $ifNull: [
                              {
                                $convert: {
                                  input:
                                    "$beginning.lessons.qaidah_quran.data.line",
                                  to: "int",
                                  onError: 0,
                                  onNull: 0,
                                },
                              },
                              0,
                            ],
                          },
                        ],
                      },
                      null,
                    ],
                  },
                  para_progress: {
                    $cond: [
                      {
                        $and: [
                          "$ending.lessons.qaidah_quran.data.para",
                          "$beginning.lessons.qaidah_quran.data.para",
                        ],
                      },
                      {
                        $subtract: [
                          {
                            $ifNull: [
                              {
                                $convert: {
                                  input:
                                    "$ending.lessons.qaidah_quran.data.para",
                                  to: "int",
                                  onError: 0,
                                  onNull: 0,
                                },
                              },
                              0,
                            ],
                          },
                          {
                            $ifNull: [
                              {
                                $convert: {
                                  input:
                                    "$beginning.lessons.qaidah_quran.data.para",
                                  to: "int",
                                  onError: 0,
                                  onNull: 0,
                                },
                              },
                              0,
                            ],
                          },
                        ],
                      },
                      null,
                    ],
                  },
                  // Store beginning and ending values for text fields
                  beginning_level: "$beginning.lessons.qaidah_quran.data.level",
                  ending_level: "$ending.lessons.qaidah_quran.data.level",
                  beginning_lesson_name:
                    "$beginning.lessons.qaidah_quran.data.lesson_name",
                  ending_lesson_name:
                    "$ending.lessons.qaidah_quran.data.lesson_name",
                },
                {
                  page_progress: 0,
                  line_progress: 0,
                  para_progress: 0,
                  beginning_level: null,
                  ending_level: null,
                  beginning_lesson_name: null,
                  ending_lesson_name: null,
                },
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
                    { $ne: ["$ending.type", "gift_muslim"] },
                  ],
                },
                {
                  page_progress: {
                    $subtract: [
                      {
                        $ifNull: [
                          {
                            $convert: {
                              input: "$ending.lessons.islamic_studies.page",
                              to: "int",
                              onError: 0,
                              onNull: 0,
                            },
                          },
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          {
                            $convert: {
                              input: "$beginning.lessons.islamic_studies.page",
                              to: "int",
                              onError: 0,
                              onNull: 0,
                            },
                          },
                          0,
                        ],
                      },
                    ],
                  },
                  // Store beginning and ending values for text fields
                  beginning_book: "$beginning.lessons.islamic_studies.book",
                  ending_book: "$ending.lessons.islamic_studies.book",
                  beginning_lesson_name:
                    "$beginning.lessons.islamic_studies.lesson_name",
                  ending_lesson_name:
                    "$ending.lessons.islamic_studies.lesson_name",
                },
                {
                  page_progress: 0,
                  beginning_book: null,
                  ending_book: null,
                  beginning_lesson_name: null,
                  ending_lesson_name: null,
                },
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
                    { $ne: ["$ending.type", "gift_muslim"] },
                  ],
                },
                {
                  page_progress: {
                    $subtract: [
                      {
                        $ifNull: [
                          {
                            $convert: {
                              input: "$ending.lessons.dua_surah.page",
                              to: "int",
                              onError: 0,
                              onNull: 0,
                            },
                          },
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          {
                            $convert: {
                              input: "$beginning.lessons.dua_surah.page",
                              to: "int",
                              onError: 0,
                              onNull: 0,
                            },
                          },
                          0,
                        ],
                      },
                    ],
                  },
                  target_progress: {
                    $subtract: [
                      {
                        $ifNull: [
                          {
                            $convert: {
                              input: "$ending.lessons.dua_surah.target",
                              to: "int",
                              onError: 0,
                              onNull: 0,
                            },
                          },
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          {
                            $convert: {
                              input: "$beginning.lessons.dua_surah.target",
                              to: "int",
                              onError: 0,
                              onNull: 0,
                            },
                          },
                          0,
                        ],
                      },
                    ],
                  },
                  dua_number_progress: {
                    $subtract: [
                      {
                        $ifNull: [
                          {
                            $convert: {
                              input: "$ending.lessons.dua_surah.dua_number",
                              to: "int",
                              onError: 0,
                              onNull: 0,
                            },
                          },
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          {
                            $convert: {
                              input: "$beginning.lessons.dua_surah.dua_number",
                              to: "int",
                              onError: 0,
                              onNull: 0,
                            },
                          },
                          0,
                        ],
                      },
                    ],
                  },
                  // Store beginning and ending values for text fields
                  beginning_book: "$beginning.lessons.dua_surah.book",
                  ending_book: "$ending.lessons.dua_surah.book",
                  beginning_level: "$beginning.lessons.dua_surah.level",
                  ending_level: "$ending.lessons.dua_surah.level",
                  beginning_lesson_name:
                    "$beginning.lessons.dua_surah.lesson_name",
                  ending_lesson_name: "$ending.lessons.dua_surah.lesson_name",
                },
                {
                  page_progress: 0,
                  target_progress: 0,
                  dua_number_progress: 0,
                  beginning_book: null,
                  ending_book: null,
                  beginning_level: null,
                  ending_level: null,
                  beginning_lesson_name: null,
                  ending_lesson_name: null,
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
                    { $eq: ["$ending.type", "gift_muslim"] },
                  ],
                },
                {
                  page_progress: {
                    $subtract: [
                      {
                        $ifNull: [
                          {
                            $convert: {
                              input: "$ending.lessons.gift_for_muslim.page",
                              to: "int",
                              onError: 0,
                              onNull: 0,
                            },
                          },
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          {
                            $convert: {
                              input: "$beginning.lessons.gift_for_muslim.page",
                              to: "int",
                              onError: 0,
                              onNull: 0,
                            },
                          },
                          0,
                        ],
                      },
                    ],
                  },
                  target_progress: {
                    $subtract: [
                      {
                        $ifNull: [
                          {
                            $convert: {
                              input: "$ending.lessons.gift_for_muslim.target",
                              to: "int",
                              onError: 0,
                              onNull: 0,
                            },
                          },
                          0,
                        ],
                      },
                      {
                        $ifNull: [
                          {
                            $convert: {
                              input:
                                "$beginning.lessons.gift_for_muslim.target",
                              to: "int",
                              onError: 0,
                              onNull: 0,
                            },
                          },
                          0,
                        ],
                      },
                    ],
                  },
                  // Store beginning and ending values for text fields
                  beginning_level: "$beginning.lessons.gift_for_muslim.level",
                  ending_level: "$ending.lessons.gift_for_muslim.level",
                  beginning_lesson_name:
                    "$beginning.lessons.gift_for_muslim.lesson_name",
                  ending_lesson_name:
                    "$ending.lessons.gift_for_muslim.lesson_name",
                },
                {
                  page_progress: 0,
                  target_progress: 0,
                  beginning_level: null,
                  ending_level: null,
                  beginning_lesson_name: null,
                  ending_lesson_name: null,
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
              type: "$type",
              year: { $literal: parseInt(year) },
            },
            processedDocumentIds: { $addToSet: "$document_ids" },

            // Sum up yearly progress for numeric fields
            qaidah_quran_yearly: {
              $sum: "$qaidah_quran_monthly.page_progress",
            },
            qaidah_quran_lines_yearly: {
              $sum: "$qaidah_quran_monthly.line_progress",
            },
            qaidah_quran_para_yearly: {
              $sum: "$qaidah_quran_monthly.para_progress",
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

            // Get the first and last values for text fields
            first_qaidah_level: {
              $first: "$qaidah_quran_monthly.beginning_level",
            },
            last_qaidah_level: { $last: "$qaidah_quran_monthly.ending_level" },
            first_qaidah_lesson: {
              $first: "$qaidah_quran_monthly.beginning_lesson_name",
            },
            last_qaidah_lesson: {
              $last: "$qaidah_quran_monthly.ending_lesson_name",
            },
            qaidah_selected: { $first: "$qaidah_quran_monthly.selected" },

            first_islamic_book: {
              $first: "$islamic_studies_monthly.beginning_book",
            },
            last_islamic_book: {
              $last: "$islamic_studies_monthly.ending_book",
            },
            first_islamic_lesson: {
              $first: "$islamic_studies_monthly.beginning_lesson_name",
            },
            last_islamic_lesson: {
              $last: "$islamic_studies_monthly.ending_lesson_name",
            },

            first_dua_book: { $first: "$dua_surah_monthly.beginning_book" },
            last_dua_book: { $last: "$dua_surah_monthly.ending_book" },
            first_dua_level: { $first: "$dua_surah_monthly.beginning_level" },
            last_dua_level: { $last: "$dua_surah_monthly.ending_level" },
            first_dua_lesson: {
              $first: "$dua_surah_monthly.beginning_lesson_name",
            },
            last_dua_lesson: { $last: "$dua_surah_monthly.ending_lesson_name" },

            first_gift_level: {
              $first: "$gift_for_muslim_monthly.beginning_level",
            },
            last_gift_level: { $last: "$gift_for_muslim_monthly.ending_level" },
            first_gift_lesson: {
              $first: "$gift_for_muslim_monthly.beginning_lesson_name",
            },
            last_gift_lesson: {
              $last: "$gift_for_muslim_monthly.ending_lesson_name",
            },

            months_with_ending: { $sum: 1 },
            months_with_both: {
              $sum: {
                $cond: [{ $eq: ["$hasBeginning", true] }, 1, 0],
              },
            },
          },
        },
        // ADDITIONAL FILTER: Only include students who have at least one complete month
        {
          $match: {
            months_with_both: { $gt: 0 },
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

            // Create the proper structure based on type
            progress: {
              $cond: [
                { $eq: ["$_id.type", "gift_muslim"] },
                {
                  // Gift for Muslim type structure
                  qaidah_quran_progress: {
                    $cond: [
                      {
                        $or: [
                          { $gt: ["$qaidah_quran_yearly", 0] },
                          { $ne: ["$first_qaidah_level", null] },
                        ],
                      },
                      {
                        selected: "$qaidah_selected",
                        page_progress: "$qaidah_quran_yearly",
                        line_progress: "$qaidah_quran_lines_yearly",
                        para_progress: "$qaidah_quran_para_yearly",
                        level_display: {
                          $cond: [
                            {
                              $and: [
                                "$first_qaidah_level",
                                "$last_qaidah_level",
                              ],
                            },
                            {
                              $concat: [
                                "$first_qaidah_level",
                                " - ",
                                "$last_qaidah_level",
                              ],
                            },
                            "N/A",
                          ],
                        },
                        lesson_name_display: {
                          $cond: [
                            {
                              $and: [
                                "$first_qaidah_lesson",
                                "$last_qaidah_lesson",
                              ],
                            },
                            {
                              $concat: [
                                "$first_qaidah_lesson",
                                " - ",
                                "$last_qaidah_lesson",
                              ],
                            },
                            "N/A",
                          ],
                        },
                      },
                      null,
                    ],
                  },
                  gift_for_muslim_progress: {
                    $cond: [
                      {
                        $or: [
                          { $gt: ["$gift_for_muslim_pages_yearly", 0] },
                          { $ne: ["$first_gift_level", null] },
                        ],
                      },
                      {
                        page_progress: "$gift_for_muslim_pages_yearly",
                        target_progress: "$gift_for_muslim_targets_yearly",
                        level_display: {
                          $cond: [
                            { $and: ["$first_gift_level", "$last_gift_level"] },
                            {
                              $concat: [
                                "$first_gift_level",
                                " - ",
                                "$last_gift_level",
                              ],
                            },
                            "N/A",
                          ],
                        },
                        lesson_name_display: {
                          $cond: [
                            {
                              $and: ["$first_gift_lesson", "$last_gift_lesson"],
                            },
                            {
                              $concat: [
                                "$first_gift_lesson",
                                " - ",
                                "$last_gift_lesson",
                              ],
                            },
                            "N/A",
                          ],
                        },
                      },
                      null,
                    ],
                  },
                  islamic_studies_progress: null,
                  dua_surah_progress: null,
                },
                {
                  // Normal type structure
                  qaidah_quran_progress: {
                    $cond: [
                      {
                        $or: [
                          { $gt: ["$qaidah_quran_yearly", 0] },
                          { $ne: ["$first_qaidah_level", null] },
                        ],
                      },
                      {
                        selected: "$qaidah_selected",
                        page_progress: "$qaidah_quran_yearly",
                        line_progress: "$qaidah_quran_lines_yearly",
                        para_progress: "$qaidah_quran_para_yearly",
                        level_display: {
                          $cond: [
                            {
                              $and: [
                                "$first_qaidah_level",
                                "$last_qaidah_level",
                              ],
                            },
                            {
                              $concat: [
                                "$first_qaidah_level",
                                " - ",
                                "$last_qaidah_level",
                              ],
                            },
                            "N/A",
                          ],
                        },
                        lesson_name_display: {
                          $cond: [
                            {
                              $and: [
                                "$first_qaidah_lesson",
                                "$last_qaidah_lesson",
                              ],
                            },
                            {
                              $concat: [
                                "$first_qaidah_lesson",
                                " - ",
                                "$last_qaidah_lesson",
                              ],
                            },
                            "N/A",
                          ],
                        },
                      },
                      null,
                    ],
                  },
                  islamic_studies_progress: {
                    $cond: [
                      {
                        $or: [
                          { $gt: ["$islamic_studies_yearly", 0] },
                          { $ne: ["$first_islamic_book", null] },
                        ],
                      },
                      {
                        page_progress: "$islamic_studies_yearly",
                        book_display: {
                          $cond: [
                            {
                              $and: [
                                "$first_islamic_book",
                                "$last_islamic_book",
                              ],
                            },
                            {
                              $concat: [
                                "$first_islamic_book",
                                " - ",
                                "$last_islamic_book",
                              ],
                            },
                            "N/A",
                          ],
                        },
                        lesson_name_display: {
                          $cond: [
                            {
                              $and: [
                                "$first_islamic_lesson",
                                "$last_islamic_lesson",
                              ],
                            },
                            {
                              $concat: [
                                "$first_islamic_lesson",
                                " - ",
                                "$last_islamic_lesson",
                              ],
                            },
                            "N/A",
                          ],
                        },
                      },
                      null,
                    ],
                  },
                  dua_surah_progress: {
                    $cond: [
                      {
                        $or: [
                          { $gt: ["$dua_surah_pages_yearly", 0] },
                          { $gt: ["$dua_surah_targets_yearly", 0] },
                          { $gt: ["$dua_surah_numbers_yearly", 0] },
                          { $ne: ["$first_dua_book", null] },
                        ],
                      },
                      {
                        page_progress: "$dua_surah_pages_yearly",
                        target_progress: "$dua_surah_targets_yearly",
                        dua_number_progress: "$dua_surah_numbers_yearly",
                        book_display: {
                          $cond: [
                            { $and: ["$first_dua_book", "$last_dua_book"] },
                            {
                              $concat: [
                                "$first_dua_book",
                                " - ",
                                "$last_dua_book",
                              ],
                            },
                            "N/A",
                          ],
                        },
                        level_display: {
                          $cond: [
                            { $and: ["$first_dua_level", "$last_dua_level"] },
                            {
                              $concat: [
                                "$first_dua_level",
                                " - ",
                                "$last_dua_level",
                              ],
                            },
                            "N/A",
                          ],
                        },
                        lesson_name_display: {
                          $cond: [
                            { $and: ["$first_dua_lesson", "$last_dua_lesson"] },
                            {
                              $concat: [
                                "$first_dua_lesson",
                                " - ",
                                "$last_dua_lesson",
                              ],
                            },
                            "N/A",
                          ],
                        },
                      },
                      null,
                    ],
                  },
                  gift_for_muslim_progress: null,
                },
              ],
            },

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
            progress: 1,
            months_with_ending: 1,
            months_with_both: 1,
          },
        },
      ];

      const result = await lessonsCoveredCollection
        .aggregate(pipeline)
        .toArray();

      console.log(
        `Yearly summary found ${result.length} records for year ${year}`
      );
      return res.status(200).json(Array.isArray(result) ? result : []);
    } catch (error) {
      console.error("Yearly summary error:", error);
      return res.status(200).json([]);
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

            // Qaidah/Quran progress - handle both qaidah/tajweed and quran/hifz cases
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
                  // For quran/hifz, we have para, page, and optional line
                  // For qaidah/tajweed, we have level, lesson_name, page, and line
                  selected: "$ending.lessons.qaidah_quran.selected",
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
                    $cond: [
                      {
                        $and: [
                          "$ending.lessons.qaidah_quran.data.line",
                          "$beginning.lessons.qaidah_quran.data.line",
                        ],
                      },
                      {
                        $subtract: [
                          {
                            $ifNull: [
                              {
                                $toInt:
                                  "$ending.lessons.qaidah_quran.data.line",
                              },
                              0,
                            ],
                          },
                          {
                            $ifNull: [
                              {
                                $toInt:
                                  "$beginning.lessons.qaidah_quran.data.line",
                              },
                              0,
                            ],
                          },
                        ],
                      },
                      null, // Return null if line data is not available
                    ],
                  },
                  para_progress: {
                    $cond: [
                      {
                        $and: [
                          "$ending.lessons.qaidah_quran.data.para",
                          "$beginning.lessons.qaidah_quran.data.para",
                        ],
                      },
                      {
                        $subtract: [
                          {
                            $ifNull: [
                              {
                                $toInt:
                                  "$ending.lessons.qaidah_quran.data.para",
                              },
                              0,
                            ],
                          },
                          {
                            $ifNull: [
                              {
                                $toInt:
                                  "$beginning.lessons.qaidah_quran.data.para",
                              },
                              0,
                            ],
                          },
                        ],
                      },
                      null, // Return null if para data is not available
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
            original_id: { $toString: "$_id" },
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
                type: "$type",
                original_id: "$original_id",
              },
            },
            document_ids: { $addToSet: "$original_id" },
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
                  selected: "$ending.lessons.qaidah_quran.selected",
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
                    $cond: [
                      {
                        $and: [
                          "$ending.lessons.qaidah_quran.data.line",
                          "$beginning.lessons.qaidah_quran.data.line",
                        ],
                      },
                      {
                        $subtract: [
                          {
                            $ifNull: [
                              {
                                $toInt:
                                  "$ending.lessons.qaidah_quran.data.line",
                              },
                              0,
                            ],
                          },
                          {
                            $ifNull: [
                              {
                                $toInt:
                                  "$beginning.lessons.qaidah_quran.data.line",
                              },
                              0,
                            ],
                          },
                        ],
                      },
                      null,
                    ],
                  },
                  para_progress: {
                    $cond: [
                      {
                        $and: [
                          "$ending.lessons.qaidah_quran.data.para",
                          "$beginning.lessons.qaidah_quran.data.para",
                        ],
                      },
                      {
                        $subtract: [
                          {
                            $ifNull: [
                              {
                                $toInt:
                                  "$ending.lessons.qaidah_quran.data.para",
                              },
                              0,
                            ],
                          },
                          {
                            $ifNull: [
                              {
                                $toInt:
                                  "$beginning.lessons.qaidah_quran.data.para",
                              },
                              0,
                            ],
                          },
                        ],
                      },
                      null,
                    ],
                  },
                  // Store beginning and ending values for text fields
                  beginning_level: "$beginning.lessons.qaidah_quran.data.level",
                  ending_level: "$ending.lessons.qaidah_quran.data.level",
                  beginning_lesson_name:
                    "$beginning.lessons.qaidah_quran.data.lesson_name",
                  ending_lesson_name:
                    "$ending.lessons.qaidah_quran.data.lesson_name",
                },
                {
                  page_progress: 0,
                  line_progress: 0,
                  para_progress: 0,
                  beginning_level: null,
                  ending_level: null,
                  beginning_lesson_name: null,
                  ending_lesson_name: null,
                },
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
                    { $ne: ["$ending.type", "gift_muslim"] },
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
                  // Store beginning and ending values for text fields
                  beginning_book: "$beginning.lessons.islamic_studies.book",
                  ending_book: "$ending.lessons.islamic_studies.book",
                  beginning_lesson_name:
                    "$beginning.lessons.islamic_studies.lesson_name",
                  ending_lesson_name:
                    "$ending.lessons.islamic_studies.lesson_name",
                },
                {
                  page_progress: 0,
                  beginning_book: null,
                  ending_book: null,
                  beginning_lesson_name: null,
                  ending_lesson_name: null,
                },
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
                    { $ne: ["$ending.type", "gift_muslim"] },
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
                  // Store beginning and ending values for text fields
                  beginning_book: "$beginning.lessons.dua_surah.book",
                  ending_book: "$ending.lessons.dua_surah.book",
                  beginning_level: "$beginning.lessons.dua_surah.level",
                  ending_level: "$ending.lessons.dua_surah.level",
                  beginning_lesson_name:
                    "$beginning.lessons.dua_surah.lesson_name",
                  ending_lesson_name: "$ending.lessons.dua_surah.lesson_name",
                },
                {
                  page_progress: 0,
                  target_progress: 0,
                  dua_number_progress: 0,
                  beginning_book: null,
                  ending_book: null,
                  beginning_level: null,
                  ending_level: null,
                  beginning_lesson_name: null,
                  ending_lesson_name: null,
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
                    { $eq: ["$ending.type", "gift_muslim"] },
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
                  // Store beginning and ending values for text fields
                  beginning_level: "$beginning.lessons.gift_for_muslim.level",
                  ending_level: "$ending.lessons.gift_for_muslim.level",
                  beginning_lesson_name:
                    "$beginning.lessons.gift_for_muslim.lesson_name",
                  ending_lesson_name:
                    "$ending.lessons.gift_for_muslim.lesson_name",
                },
                {
                  page_progress: 0,
                  target_progress: 0,
                  beginning_level: null,
                  ending_level: null,
                  beginning_lesson_name: null,
                  ending_lesson_name: null,
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
              type: "$type",
              year: { $literal: parseInt(year) },
            },
            processedDocumentIds: { $addToSet: "$document_ids" },

            // Sum up yearly progress for numeric fields
            qaidah_quran_yearly: {
              $sum: "$qaidah_quran_monthly.page_progress",
            },
            qaidah_quran_lines_yearly: {
              $sum: "$qaidah_quran_monthly.line_progress",
            },
            qaidah_quran_para_yearly: {
              $sum: "$qaidah_quran_monthly.para_progress",
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

            // Get the first and last values for text fields
            first_qaidah_level: {
              $first: "$qaidah_quran_monthly.beginning_level",
            },
            last_qaidah_level: { $last: "$qaidah_quran_monthly.ending_level" },
            first_qaidah_lesson: {
              $first: "$qaidah_quran_monthly.beginning_lesson_name",
            },
            last_qaidah_lesson: {
              $last: "$qaidah_quran_monthly.ending_lesson_name",
            },
            qaidah_selected: { $first: "$qaidah_quran_monthly.selected" },

            first_islamic_book: {
              $first: "$islamic_studies_monthly.beginning_book",
            },
            last_islamic_book: {
              $last: "$islamic_studies_monthly.ending_book",
            },
            first_islamic_lesson: {
              $first: "$islamic_studies_monthly.beginning_lesson_name",
            },
            last_islamic_lesson: {
              $last: "$islamic_studies_monthly.ending_lesson_name",
            },

            first_dua_book: { $first: "$dua_surah_monthly.beginning_book" },
            last_dua_book: { $last: "$dua_surah_monthly.ending_book" },
            first_dua_level: { $first: "$dua_surah_monthly.beginning_level" },
            last_dua_level: { $last: "$dua_surah_monthly.ending_level" },
            first_dua_lesson: {
              $first: "$dua_surah_monthly.beginning_lesson_name",
            },
            last_dua_lesson: { $last: "$dua_surah_monthly.ending_lesson_name" },

            first_gift_level: {
              $first: "$gift_for_muslim_monthly.beginning_level",
            },
            last_gift_level: { $last: "$gift_for_muslim_monthly.ending_level" },
            first_gift_lesson: {
              $first: "$gift_for_muslim_monthly.beginning_lesson_name",
            },
            last_gift_lesson: {
              $last: "$gift_for_muslim_monthly.ending_lesson_name",
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

            // Create the proper structure based on type
            progress: {
              $cond: [
                { $eq: ["$_id.type", "gift_muslim"] },
                {
                  // Gift for Muslim type structure
                  qaidah_quran_progress: {
                    $cond: [
                      {
                        $or: [
                          { $gt: ["$qaidah_quran_yearly", 0] },
                          { $ne: ["$first_qaidah_level", null] },
                        ],
                      },
                      {
                        selected: "$qaidah_selected",
                        page_progress: "$qaidah_quran_yearly",
                        line_progress: "$qaidah_quran_lines_yearly",
                        para_progress: "$qaidah_quran_para_yearly",
                        level_display: {
                          $cond: [
                            {
                              $and: [
                                "$first_qaidah_level",
                                "$last_qaidah_level",
                              ],
                            },
                            {
                              $concat: [
                                "$first_qaidah_level",
                                " - ",
                                "$last_qaidah_level",
                              ],
                            },
                            "N/A",
                          ],
                        },
                        lesson_name_display: {
                          $cond: [
                            {
                              $and: [
                                "$first_qaidah_lesson",
                                "$last_qaidah_lesson",
                              ],
                            },
                            {
                              $concat: [
                                "$first_qaidah_lesson",
                                " - ",
                                "$last_qaidah_lesson",
                              ],
                            },
                            "N/A",
                          ],
                        },
                      },
                      null,
                    ],
                  },
                  gift_for_muslim_progress: {
                    $cond: [
                      {
                        $or: [
                          { $gt: ["$gift_for_muslim_pages_yearly", 0] },
                          { $ne: ["$first_gift_level", null] },
                        ],
                      },
                      {
                        page_progress: "$gift_for_muslim_pages_yearly",
                        target_progress: "$gift_for_muslim_targets_yearly",
                        level_display: {
                          $cond: [
                            { $and: ["$first_gift_level", "$last_gift_level"] },
                            {
                              $concat: [
                                "$first_gift_level",
                                " - ",
                                "$last_gift_level",
                              ],
                            },
                            "N/A",
                          ],
                        },
                        lesson_name_display: {
                          $cond: [
                            {
                              $and: ["$first_gift_lesson", "$last_gift_lesson"],
                            },
                            {
                              $concat: [
                                "$first_gift_lesson",
                                " - ",
                                "$last_gift_lesson",
                              ],
                            },
                            "N/A",
                          ],
                        },
                      },
                      null,
                    ],
                  },
                  islamic_studies_progress: null,
                  dua_surah_progress: null,
                },
                {
                  // Normal type structure
                  qaidah_quran_progress: {
                    $cond: [
                      {
                        $or: [
                          { $gt: ["$qaidah_quran_yearly", 0] },
                          { $ne: ["$first_qaidah_level", null] },
                        ],
                      },
                      {
                        selected: "$qaidah_selected",
                        page_progress: "$qaidah_quran_yearly",
                        line_progress: "$qaidah_quran_lines_yearly",
                        para_progress: "$qaidah_quran_para_yearly",
                        level_display: {
                          $cond: [
                            {
                              $and: [
                                "$first_qaidah_level",
                                "$last_qaidah_level",
                              ],
                            },
                            {
                              $concat: [
                                "$first_qaidah_level",
                                " - ",
                                "$last_qaidah_level",
                              ],
                            },
                            "N/A",
                          ],
                        },
                        lesson_name_display: {
                          $cond: [
                            {
                              $and: [
                                "$first_qaidah_lesson",
                                "$last_qaidah_lesson",
                              ],
                            },
                            {
                              $concat: [
                                "$first_qaidah_lesson",
                                " - ",
                                "$last_qaidah_lesson",
                              ],
                            },
                            "N/A",
                          ],
                        },
                      },
                      null,
                    ],
                  },
                  islamic_studies_progress: {
                    $cond: [
                      {
                        $or: [
                          { $gt: ["$islamic_studies_yearly", 0] },
                          { $ne: ["$first_islamic_book", null] },
                        ],
                      },
                      {
                        page_progress: "$islamic_studies_yearly",
                        book_display: {
                          $cond: [
                            {
                              $and: [
                                "$first_islamic_book",
                                "$last_islamic_book",
                              ],
                            },
                            {
                              $concat: [
                                "$first_islamic_book",
                                " - ",
                                "$last_islamic_book",
                              ],
                            },
                            "N/A",
                          ],
                        },
                        lesson_name_display: {
                          $cond: [
                            {
                              $and: [
                                "$first_islamic_lesson",
                                "$last_islamic_lesson",
                              ],
                            },
                            {
                              $concat: [
                                "$first_islamic_lesson",
                                " - ",
                                "$last_islamic_lesson",
                              ],
                            },
                            "N/A",
                          ],
                        },
                      },
                      null,
                    ],
                  },
                  dua_surah_progress: {
                    $cond: [
                      {
                        $or: [
                          { $gt: ["$dua_surah_pages_yearly", 0] },
                          { $gt: ["$dua_surah_targets_yearly", 0] },
                          { $gt: ["$dua_surah_numbers_yearly", 0] },
                          { $ne: ["$first_dua_book", null] },
                        ],
                      },
                      {
                        page_progress: "$dua_surah_pages_yearly",
                        target_progress: "$dua_surah_targets_yearly",
                        dua_number_progress: "$dua_surah_numbers_yearly",
                        book_display: {
                          $cond: [
                            { $and: ["$first_dua_book", "$last_dua_book"] },
                            {
                              $concat: [
                                "$first_dua_book",
                                " - ",
                                "$last_dua_book",
                              ],
                            },
                            "N/A",
                          ],
                        },
                        level_display: {
                          $cond: [
                            { $and: ["$first_dua_level", "$last_dua_level"] },
                            {
                              $concat: [
                                "$first_dua_level",
                                " - ",
                                "$last_dua_level",
                              ],
                            },
                            "N/A",
                          ],
                        },
                        lesson_name_display: {
                          $cond: [
                            { $and: ["$first_dua_lesson", "$last_dua_lesson"] },
                            {
                              $concat: [
                                "$first_dua_lesson",
                                " - ",
                                "$last_dua_lesson",
                              ],
                            },
                            "N/A",
                          ],
                        },
                      },
                      null,
                    ],
                  },
                  gift_for_muslim_progress: null,
                },
              ],
            },

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
            progress: 1,
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
  // Student monthly summary - UPDATED with gift_muslim support
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
        monthly_publish: true,
        year,
      };
      if (month) matchConditions.month = month;

      const pipeline = [
        { $match: matchConditions },

        // Add helper fields
        {
          $addFields: {
            original_id: { $toString: "$_id" },
          },
        },

        // Group by student, month, year, subject
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
                lessons: "$lessons",
                type: "$type",
                original_id: "$original_id",
                class_id: "$class_id",
              },
            },
          },
        },

        // Separate beginning and ending
        {
          $project: {
            _id: 0,
            student_id: "$_id.student_id",
            month: "$_id.month",
            year: "$_id.year",
            subject_id: "$_id.subject_id",
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

        // Must have an ending
        { $match: { ending: { $ne: null } } },

        // Progress calculations - INCLUDING ALL FIELDS LIKE TEACHER ROUTE
        {
          $project: {
            student_id: 1,
            month: 1,
            year: 1,
            subject_id: 1,
            class_id: "$ending.class_id",

            type: {
              $cond: [
                { $ne: ["$ending.type", null] },
                "$ending.type",
                "$beginning.type",
              ],
            },

            // Qaidah/Quran progress - INCLUDING ALL FIELDS
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
                  selected: "$ending.lessons.qaidah_quran.selected",
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
                    $cond: [
                      {
                        $and: [
                          "$ending.lessons.qaidah_quran.data.line",
                          "$beginning.lessons.qaidah_quran.data.line",
                        ],
                      },
                      {
                        $subtract: [
                          {
                            $ifNull: [
                              {
                                $toInt:
                                  "$ending.lessons.qaidah_quran.data.line",
                              },
                              0,
                            ],
                          },
                          {
                            $ifNull: [
                              {
                                $toInt:
                                  "$beginning.lessons.qaidah_quran.data.line",
                              },
                              0,
                            ],
                          },
                        ],
                      },
                      null,
                    ],
                  },
                  para_progress: {
                    $cond: [
                      {
                        $and: [
                          "$ending.lessons.qaidah_quran.data.para",
                          "$beginning.lessons.qaidah_quran.data.para",
                        ],
                      },
                      {
                        $subtract: [
                          {
                            $ifNull: [
                              {
                                $toInt:
                                  "$ending.lessons.qaidah_quran.data.para",
                              },
                              0,
                            ],
                          },
                          {
                            $ifNull: [
                              {
                                $toInt:
                                  "$beginning.lessons.qaidah_quran.data.para",
                              },
                              0,
                            ],
                          },
                        ],
                      },
                      null,
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
                },
                null,
              ],
            },

            // Islamic Studies progress - INCLUDING ALL FIELDS
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
                    { $ne: ["$ending.type", "gift_muslim"] },
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

            // Dua/Surah progress - INCLUDING ALL FIELDS
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
                    { $ne: ["$ending.type", "gift_muslim"] },
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

            // Gift for Muslim progress - INCLUDING ALL FIELDS
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
                    { $eq: ["$ending.type", "gift_muslim"] },
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
            isPublished: { $literal: true },
          },
        },

        // Lookups
        {
          $lookup: {
            from: "students",
            localField: "student_id",
            foreignField: "student_id",
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
            foreignField: "class_id",
            as: "class_info",
          },
        },
        { $unwind: { path: "$class_info", preserveNullAndEmptyArrays: true } },

        {
          $lookup: {
            from: "subjects",
            localField: "subject_id",
            foreignField: "subject_id",
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
            month: 1,
            year: 1,
            type: 1,
            class_name: "$class_info.class_name",
            subject_name: "$subject_info.subject_name",
            qaidah_quran_progress: 1,
            islamic_studies_progress: 1,
            dua_surah_progress: 1,
            gift_for_muslim_progress: 1,
            hasBeginning: 1,
            hasEnding: 1,
            processedDocumentIds: 1,
            isPublished: 1,
          },
        },
      ];

      const result = await lessonsCoveredCollection
        .aggregate(pipeline)
        .toArray();
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

      const pipeline = [
        {
          $match: {
            student_id: { $in: studentIdsArray },
            year: year,
            yearly_publish: true, // Only published records for students
          },
        },
        {
          $addFields: {
            original_id: { $toString: "$_id" },
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
                type: "$type",
                original_id: "$original_id",
              },
            },
            document_ids: { $addToSet: "$original_id" },
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
                  selected: "$ending.lessons.qaidah_quran.selected",
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
                    $cond: [
                      {
                        $and: [
                          "$ending.lessons.qaidah_quran.data.line",
                          "$beginning.lessons.qaidah_quran.data.line",
                        ],
                      },
                      {
                        $subtract: [
                          {
                            $ifNull: [
                              {
                                $toInt:
                                  "$ending.lessons.qaidah_quran.data.line",
                              },
                              0,
                            ],
                          },
                          {
                            $ifNull: [
                              {
                                $toInt:
                                  "$beginning.lessons.qaidah_quran.data.line",
                              },
                              0,
                            ],
                          },
                        ],
                      },
                      null,
                    ],
                  },
                  para_progress: {
                    $cond: [
                      {
                        $and: [
                          "$ending.lessons.qaidah_quran.data.para",
                          "$beginning.lessons.qaidah_quran.data.para",
                        ],
                      },
                      {
                        $subtract: [
                          {
                            $ifNull: [
                              {
                                $toInt:
                                  "$ending.lessons.qaidah_quran.data.para",
                              },
                              0,
                            ],
                          },
                          {
                            $ifNull: [
                              {
                                $toInt:
                                  "$beginning.lessons.qaidah_quran.data.para",
                              },
                              0,
                            ],
                          },
                        ],
                      },
                      null,
                    ],
                  },
                  // Store beginning and ending values for text fields
                  beginning_level: "$beginning.lessons.qaidah_quran.data.level",
                  ending_level: "$ending.lessons.qaidah_quran.data.level",
                  beginning_lesson_name:
                    "$beginning.lessons.qaidah_quran.data.lesson_name",
                  ending_lesson_name:
                    "$ending.lessons.qaidah_quran.data.lesson_name",
                },
                {
                  page_progress: 0,
                  line_progress: 0,
                  para_progress: 0,
                  beginning_level: null,
                  ending_level: null,
                  beginning_lesson_name: null,
                  ending_lesson_name: null,
                },
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
                    { $ne: ["$ending.type", "gift_muslim"] },
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
                  // Store beginning and ending values for text fields
                  beginning_book: "$beginning.lessons.islamic_studies.book",
                  ending_book: "$ending.lessons.islamic_studies.book",
                  beginning_lesson_name:
                    "$beginning.lessons.islamic_studies.lesson_name",
                  ending_lesson_name:
                    "$ending.lessons.islamic_studies.lesson_name",
                },
                {
                  page_progress: 0,
                  beginning_book: null,
                  ending_book: null,
                  beginning_lesson_name: null,
                  ending_lesson_name: null,
                },
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
                    { $ne: ["$ending.type", "gift_muslim"] },
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
                  // Store beginning and ending values for text fields
                  beginning_book: "$beginning.lessons.dua_surah.book",
                  ending_book: "$ending.lessons.dua_surah.book",
                  beginning_level: "$beginning.lessons.dua_surah.level",
                  ending_level: "$ending.lessons.dua_surah.level",
                  beginning_lesson_name:
                    "$beginning.lessons.dua_surah.lesson_name",
                  ending_lesson_name: "$ending.lessons.dua_surah.lesson_name",
                },
                {
                  page_progress: 0,
                  target_progress: 0,
                  dua_number_progress: 0,
                  beginning_book: null,
                  ending_book: null,
                  beginning_level: null,
                  ending_level: null,
                  beginning_lesson_name: null,
                  ending_lesson_name: null,
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
                    { $eq: ["$ending.type", "gift_muslim"] },
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
                  // Store beginning and ending values for text fields
                  beginning_level: "$beginning.lessons.gift_for_muslim.level",
                  ending_level: "$ending.lessons.gift_for_muslim.level",
                  beginning_lesson_name:
                    "$beginning.lessons.gift_for_muslim.lesson_name",
                  ending_lesson_name:
                    "$ending.lessons.gift_for_muslim.lesson_name",
                },
                {
                  page_progress: 0,
                  target_progress: 0,
                  beginning_level: null,
                  ending_level: null,
                  beginning_lesson_name: null,
                  ending_lesson_name: null,
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
              type: "$type",
              year: { $literal: parseInt(year) },
            },
            processedDocumentIds: { $addToSet: "$document_ids" },

            // Sum up yearly progress for numeric fields
            qaidah_quran_yearly: {
              $sum: "$qaidah_quran_monthly.page_progress",
            },
            qaidah_quran_lines_yearly: {
              $sum: "$qaidah_quran_monthly.line_progress",
            },
            qaidah_quran_para_yearly: {
              $sum: "$qaidah_quran_monthly.para_progress",
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

            // Get the first and last values for text fields
            first_qaidah_level: {
              $first: "$qaidah_quran_monthly.beginning_level",
            },
            last_qaidah_level: { $last: "$qaidah_quran_monthly.ending_level" },
            first_qaidah_lesson: {
              $first: "$qaidah_quran_monthly.beginning_lesson_name",
            },
            last_qaidah_lesson: {
              $last: "$qaidah_quran_monthly.ending_lesson_name",
            },
            qaidah_selected: { $first: "$qaidah_quran_monthly.selected" },

            first_islamic_book: {
              $first: "$islamic_studies_monthly.beginning_book",
            },
            last_islamic_book: {
              $last: "$islamic_studies_monthly.ending_book",
            },
            first_islamic_lesson: {
              $first: "$islamic_studies_monthly.beginning_lesson_name",
            },
            last_islamic_lesson: {
              $last: "$islamic_studies_monthly.ending_lesson_name",
            },

            first_dua_book: { $first: "$dua_surah_monthly.beginning_book" },
            last_dua_book: { $last: "$dua_surah_monthly.ending_book" },
            first_dua_level: { $first: "$dua_surah_monthly.beginning_level" },
            last_dua_level: { $last: "$dua_surah_monthly.ending_level" },
            first_dua_lesson: {
              $first: "$dua_surah_monthly.beginning_lesson_name",
            },
            last_dua_lesson: { $last: "$dua_surah_monthly.ending_lesson_name" },

            first_gift_level: {
              $first: "$gift_for_muslim_monthly.beginning_level",
            },
            last_gift_level: { $last: "$gift_for_muslim_monthly.ending_level" },
            first_gift_lesson: {
              $first: "$gift_for_muslim_monthly.beginning_lesson_name",
            },
            last_gift_lesson: {
              $last: "$gift_for_muslim_monthly.ending_lesson_name",
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

            // Create the proper structure based on type (same as teacher route)
            progress: {
              $cond: [
                { $eq: ["$_id.type", "gift_muslim"] },
                {
                  // Gift for Muslim type structure
                  qaidah_quran_progress: {
                    $cond: [
                      {
                        $or: [
                          { $gt: ["$qaidah_quran_yearly", 0] },
                          { $ne: ["$first_qaidah_level", null] },
                        ],
                      },
                      {
                        selected: "$qaidah_selected",
                        page_progress: "$qaidah_quran_yearly",
                        line_progress: "$qaidah_quran_lines_yearly",
                        para_progress: "$qaidah_quran_para_yearly",
                        level_display: {
                          $cond: [
                            {
                              $and: [
                                "$first_qaidah_level",
                                "$last_qaidah_level",
                              ],
                            },
                            {
                              $concat: [
                                "$first_qaidah_level",
                                " - ",
                                "$last_qaidah_level",
                              ],
                            },
                            "N/A",
                          ],
                        },
                        lesson_name_display: {
                          $cond: [
                            {
                              $and: [
                                "$first_qaidah_lesson",
                                "$last_qaidah_lesson",
                              ],
                            },
                            {
                              $concat: [
                                "$first_qaidah_lesson",
                                " - ",
                                "$last_qaidah_lesson",
                              ],
                            },
                            "N/A",
                          ],
                        },
                      },
                      null,
                    ],
                  },
                  gift_for_muslim_progress: {
                    $cond: [
                      {
                        $or: [
                          { $gt: ["$gift_for_muslim_pages_yearly", 0] },
                          { $ne: ["$first_gift_level", null] },
                        ],
                      },
                      {
                        page_progress: "$gift_for_muslim_pages_yearly",
                        target_progress: "$gift_for_muslim_targets_yearly",
                        level_display: {
                          $cond: [
                            { $and: ["$first_gift_level", "$last_gift_level"] },
                            {
                              $concat: [
                                "$first_gift_level",
                                " - ",
                                "$last_gift_level",
                              ],
                            },
                            "N/A",
                          ],
                        },
                        lesson_name_display: {
                          $cond: [
                            {
                              $and: ["$first_gift_lesson", "$last_gift_lesson"],
                            },
                            {
                              $concat: [
                                "$first_gift_lesson",
                                " - ",
                                "$last_gift_lesson",
                              ],
                            },
                            "N/A",
                          ],
                        },
                      },
                      null,
                    ],
                  },
                  islamic_studies_progress: null,
                  dua_surah_progress: null,
                },
                {
                  // Normal type structure
                  qaidah_quran_progress: {
                    $cond: [
                      {
                        $or: [
                          { $gt: ["$qaidah_quran_yearly", 0] },
                          { $ne: ["$first_qaidah_level", null] },
                        ],
                      },
                      {
                        selected: "$qaidah_selected",
                        page_progress: "$qaidah_quran_yearly",
                        line_progress: "$qaidah_quran_lines_yearly",
                        para_progress: "$qaidah_quran_para_yearly",
                        level_display: {
                          $cond: [
                            {
                              $and: [
                                "$first_qaidah_level",
                                "$last_qaidah_level",
                              ],
                            },
                            {
                              $concat: [
                                "$first_qaidah_level",
                                " - ",
                                "$last_qaidah_level",
                              ],
                            },
                            "N/A",
                          ],
                        },
                        lesson_name_display: {
                          $cond: [
                            {
                              $and: [
                                "$first_qaidah_lesson",
                                "$last_qaidah_lesson",
                              ],
                            },
                            {
                              $concat: [
                                "$first_qaidah_lesson",
                                " - ",
                                "$last_qaidah_lesson",
                              ],
                            },
                            "N/A",
                          ],
                        },
                      },
                      null,
                    ],
                  },
                  islamic_studies_progress: {
                    $cond: [
                      {
                        $or: [
                          { $gt: ["$islamic_studies_yearly", 0] },
                          { $ne: ["$first_islamic_book", null] },
                        ],
                      },
                      {
                        page_progress: "$islamic_studies_yearly",
                        book_display: {
                          $cond: [
                            {
                              $and: [
                                "$first_islamic_book",
                                "$last_islamic_book",
                              ],
                            },
                            {
                              $concat: [
                                "$first_islamic_book",
                                " - ",
                                "$last_islamic_book",
                              ],
                            },
                            "N/A",
                          ],
                        },
                        lesson_name_display: {
                          $cond: [
                            {
                              $and: [
                                "$first_islamic_lesson",
                                "$last_islamic_lesson",
                              ],
                            },
                            {
                              $concat: [
                                "$first_islamic_lesson",
                                " - ",
                                "$last_islamic_lesson",
                              ],
                            },
                            "N/A",
                          ],
                        },
                      },
                      null,
                    ],
                  },
                  dua_surah_progress: {
                    $cond: [
                      {
                        $or: [
                          { $gt: ["$dua_surah_pages_yearly", 0] },
                          { $gt: ["$dua_surah_targets_yearly", 0] },
                          { $gt: ["$dua_surah_numbers_yearly", 0] },
                          { $ne: ["$first_dua_book", null] },
                        ],
                      },
                      {
                        page_progress: "$dua_surah_pages_yearly",
                        target_progress: "$dua_surah_targets_yearly",
                        dua_number_progress: "$dua_surah_numbers_yearly",
                        book_display: {
                          $cond: [
                            { $and: ["$first_dua_book", "$last_dua_book"] },
                            {
                              $concat: [
                                "$first_dua_book",
                                " - ",
                                "$last_dua_book",
                              ],
                            },
                            "N/A",
                          ],
                        },
                        level_display: {
                          $cond: [
                            { $and: ["$first_dua_level", "$last_dua_level"] },
                            {
                              $concat: [
                                "$first_dua_level",
                                " - ",
                                "$last_dua_level",
                              ],
                            },
                            "N/A",
                          ],
                        },
                        lesson_name_display: {
                          $cond: [
                            { $and: ["$first_dua_lesson", "$last_dua_lesson"] },
                            {
                              $concat: [
                                "$first_dua_lesson",
                                " - ",
                                "$last_dua_lesson",
                              ],
                            },
                            "N/A",
                          ],
                        },
                      },
                      null,
                    ],
                  },
                  gift_for_muslim_progress: null,
                },
              ],
            },

            months_with_ending: 1,
            months_with_both: 1,
          },
        },
        // Lookup student and class information using string fields
        {
          $lookup: {
            from: "students",
            localField: "student_id",
            foreignField: "student_id",
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
            foreignField: "class_id",
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
            progress: 1,
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
      console.error("Student yearly summary error:", error);
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
