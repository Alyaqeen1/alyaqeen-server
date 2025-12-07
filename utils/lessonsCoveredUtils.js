export const commonPipelineStages = {
  // Convert string IDs to ObjectId with empty string handling
  convertIds: {
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
            $and: [{ $ne: ["$class_id", ""] }, { $ne: ["$class_id", null] }],
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

  // Group and separate beginning/ending entries
  groupAndSeparate: (groupFields) => ({
    $group: {
      _id: groupFields,
      entries: {
        $push: {
          time_of_month: "$time_of_month",
          lessons: "$lessons",
          original_id: "$original_id",
          monthly_publish: "$monthly_publish",
          yearly_publish: "$yearly_publish",
          type: "$type",
          teacher_id: "$teacher_id",
          class_id: "$class_id",
          department_id: "$department_id",
        },
      },
      class_id: { $first: "$class_id" },
      teacher_id: { $first: "$teacher_id" },
      department_id: { $first: "$department_id" },
    },
  }),

  // Separate beginning and ending entries
  separateEntries: {
    $addFields: {
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

  // Filter only complete pairs
  filterCompletePairs: {
    $match: {
      $and: [{ beginning: { $ne: null } }, { ending: { $ne: null } }],
    },
  },

  // Calculate progress for all lesson types
  calculateProgress: {
    $project: {
      student_id: "$_id.student_id",
      month: "$_id.month",
      year: "$_id.year",
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

      // Qaidah/Quran progress (keep this the same)
      qaidah_quran_progress: {
        $cond: [
          {
            $and: [
              "$beginning.lessons.qaidah_quran",
              "$ending.lessons.qaidah_quran",
            ],
          },
          {
            selected: "$ending.lessons.qaidah_quran.selected",
            page_progress: {
              $cond: [
                {
                  $and: [
                    "$beginning.lessons.qaidah_quran",
                    "$ending.lessons.qaidah_quran",
                  ],
                },
                {
                  // For Quran/Hifz: Show "Juz X page Y → Juz A page B"
                  $cond: [
                    {
                      $in: [
                        "$ending.lessons.qaidah_quran.selected",
                        ["quran", "hifz"],
                      ],
                    },
                    {
                      $cond: [
                        {
                          $and: [
                            "$beginning.lessons.qaidah_quran.data.para",
                            "$ending.lessons.qaidah_quran.data.para",
                            "$beginning.lessons.qaidah_quran.data.page",
                            "$ending.lessons.qaidah_quran.data.page",
                          ],
                        },
                        {
                          $concat: [
                            "Juz ",
                            "$beginning.lessons.qaidah_quran.data.para",
                            " page ",
                            "$beginning.lessons.qaidah_quran.data.page",
                            " → Juz ",
                            "$ending.lessons.qaidah_quran.data.para",
                            " page ",
                            "$ending.lessons.qaidah_quran.data.page",
                          ],
                        },
                        "N/A",
                      ],
                    },
                    // For Qaidah/Tajweed: Show "Level X page Y → Level A page B"
                    {
                      $cond: [
                        {
                          $and: [
                            "$beginning.lessons.qaidah_quran.data.level",
                            "$ending.lessons.qaidah_quran.data.level",
                            "$beginning.lessons.qaidah_quran.data.page",
                            "$ending.lessons.qaidah_quran.data.page",
                          ],
                        },
                        {
                          $concat: [
                            "$beginning.lessons.qaidah_quran.data.level",
                            " page ",
                            "$beginning.lessons.qaidah_quran.data.page",
                            " → ",
                            "$ending.lessons.qaidah_quran.data.level",
                            " page ",
                            "$ending.lessons.qaidah_quran.data.page",
                          ],
                        },
                        "N/A",
                      ],
                    },
                  ],
                },
                "N/A",
              ],
            },
            line_progress: {
              $let: {
                vars: {
                  startPage: {
                    $ifNull: ["$beginning.lessons.qaidah_quran.data.page", "0"],
                  },
                  startLine: {
                    $ifNull: ["$beginning.lessons.qaidah_quran.data.line", "0"],
                  },
                  endPage: {
                    $ifNull: ["$ending.lessons.qaidah_quran.data.page", "0"],
                  },
                  endLine: {
                    $ifNull: ["$ending.lessons.qaidah_quran.data.line", "0"],
                  },
                },
                in: {
                  $concat: [
                    "page ",
                    "$$startPage",
                    " line ",
                    "$$startLine",
                    " - page ",
                    "$$endPage",
                    " line ",
                    "$$endLine",
                  ],
                },
              },
            },
            para_progress: {
              $cond: [
                {
                  $and: [
                    "$beginning.lessons.qaidah_quran.data.para",
                    "$ending.lessons.qaidah_quran.data.para",
                  ],
                },
                {
                  $let: {
                    vars: {
                      startPara: {
                        $ifNull: [
                          {
                            $convert: {
                              input:
                                "$beginning.lessons.qaidah_quran.data.para",
                              to: "double",
                              onError: 0,
                              onNull: 0,
                            },
                          },
                          0,
                        ],
                      },
                      endPara: {
                        $ifNull: [
                          {
                            $convert: {
                              input: "$ending.lessons.qaidah_quran.data.para",
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
                      $subtract: ["$$endPara", "$$startPara"],
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
                    {
                      $in: [
                        "$ending.lessons.qaidah_quran.selected",
                        ["qaidah", "tajweed"],
                      ],
                    },
                    "$beginning.lessons.qaidah_quran.data.level",
                    "$ending.lessons.qaidah_quran.data.level",
                  ],
                },
                {
                  $concat: [
                    {
                      $ifNull: [
                        "$beginning.lessons.qaidah_quran.data.level",
                        "Start",
                      ],
                    },
                    " → ",
                    {
                      $ifNull: [
                        "$ending.lessons.qaidah_quran.data.level",
                        "End",
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
                    {
                      $in: [
                        "$ending.lessons.qaidah_quran.selected",
                        ["qaidah", "tajweed"],
                      ],
                    },
                    "$beginning.lessons.qaidah_quran.data.lesson_name",
                    "$ending.lessons.qaidah_quran.data.lesson_name",
                  ],
                },
                {
                  $concat: [
                    {
                      $ifNull: [
                        "$beginning.lessons.qaidah_quran.data.lesson_name",
                        "Start",
                      ],
                    },
                    " → ",
                    {
                      $ifNull: [
                        "$ending.lessons.qaidah_quran.data.lesson_name",
                        "End",
                      ],
                    },
                  ],
                },
                "N/A",
              ],
            },
            para_display: {
              $cond: [
                {
                  $and: [
                    {
                      $in: [
                        "$ending.lessons.qaidah_quran.selected",
                        ["quran", "hifz"],
                      ],
                    },
                    "$beginning.lessons.qaidah_quran.data.para",
                    "$ending.lessons.qaidah_quran.data.para",
                  ],
                },
                {
                  $concat: [
                    {
                      $ifNull: [
                        "$beginning.lessons.qaidah_quran.data.para",
                        "Start",
                      ],
                    },
                    " → ",
                    {
                      $ifNull: [
                        "$ending.lessons.qaidah_quran.data.para",
                        "End",
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

      // Islamic Studies progress (keep this the same)
      islamic_studies_progress: {
        $cond: [
          {
            $and: [
              "$beginning.lessons.islamic_studies",
              "$ending.lessons.islamic_studies",
              { $ne: ["$type", "gift_muslim"] },
            ],
          },
          {
            page_progress: {
              $cond: [
                {
                  $and: [
                    "$beginning.lessons.islamic_studies.page",
                    "$ending.lessons.islamic_studies.page",
                    "$beginning.lessons.islamic_studies.book",
                    "$ending.lessons.islamic_studies.book",
                  ],
                },
                {
                  $concat: [
                    "$beginning.lessons.islamic_studies.book",
                    " page ",
                    "$beginning.lessons.islamic_studies.page",
                    " → ",
                    "$ending.lessons.islamic_studies.book",
                    " page ",
                    "$ending.lessons.islamic_studies.page",
                  ],
                },
                "N/A",
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
                        "Start",
                      ],
                    },
                    " → ",
                    {
                      $ifNull: ["$ending.lessons.islamic_studies.book", "End"],
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
                        "Start",
                      ],
                    },
                    " → ",
                    {
                      $ifNull: [
                        "$ending.lessons.islamic_studies.lesson_name",
                        "End",
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

      // Dua/Surah progress - FIXED TARGET DISPLAY
      dua_surah_progress: {
        $cond: [
          {
            $and: [
              "$beginning.lessons.dua_surah",
              "$ending.lessons.dua_surah",
              { $ne: ["$type", "gift_muslim"] },
            ],
          },
          {
            page_progress: {
              $cond: [
                {
                  $and: [
                    "$beginning.lessons.dua_surah.page",
                    "$ending.lessons.dua_surah.page",
                    "$beginning.lessons.dua_surah.level",
                    "$ending.lessons.dua_surah.level",
                  ],
                },
                {
                  $concat: [
                    "$beginning.lessons.dua_surah.level",
                    " page ",
                    "$beginning.lessons.dua_surah.page",
                    " → ",
                    "$ending.lessons.dua_surah.level",
                    " page ",
                    "$ending.lessons.dua_surah.page",
                  ],
                },
                "N/A",
              ],
            },
            // FIXED: Show beginning and ending target instead of subtraction
            target_display: {
              $cond: [
                {
                  $and: [
                    "$beginning.lessons.dua_surah.target",
                    "$ending.lessons.dua_surah.target",
                  ],
                },
                {
                  $concat: [
                    {
                      $ifNull: ["$beginning.lessons.dua_surah.target", "Start"],
                    },
                    " → ",
                    {
                      $ifNull: ["$ending.lessons.dua_surah.target", "End"],
                    },
                  ],
                },
                "N/A",
              ],
            },
            dua_number_progress: {
              $let: {
                vars: {
                  startDua: {
                    $ifNull: [
                      {
                        $convert: {
                          input: "$beginning.lessons.dua_surah.dua_number",
                          to: "double",
                          onError: 0,
                          onNull: 0,
                        },
                      },
                      0,
                    ],
                  },
                  endDua: {
                    $ifNull: [
                      {
                        $convert: {
                          input: "$ending.lessons.dua_surah.dua_number",
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
                  $subtract: ["$$endDua", "$$startDua"],
                },
              },
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
                      $ifNull: ["$beginning.lessons.dua_surah.book", "Start"],
                    },
                    " → ",
                    {
                      $ifNull: ["$ending.lessons.dua_surah.book", "End"],
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
                      $ifNull: ["$beginning.lessons.dua_surah.level", "Start"],
                    },
                    " → ",
                    {
                      $ifNull: ["$ending.lessons.dua_surah.level", "End"],
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
                        "Start",
                      ],
                    },
                    " → ",
                    {
                      $ifNull: ["$ending.lessons.dua_surah.lesson_name", "End"],
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

      // Gift for Muslim progress - FIXED TARGET DISPLAY
      gift_for_muslim_progress: {
        $cond: [
          {
            $and: [
              { $eq: ["$ending.type", "gift_muslim"] },
              "$beginning.lessons.gift_for_muslim",
              "$ending.lessons.gift_for_muslim",
            ],
          },
          {
            page_progress: {
              $cond: [
                {
                  $and: [
                    "$beginning.lessons.gift_for_muslim.page",
                    "$ending.lessons.gift_for_muslim.page",
                    "$beginning.lessons.gift_for_muslim.level",
                    "$ending.lessons.gift_for_muslim.level",
                  ],
                },
                {
                  $concat: [
                    "$beginning.lessons.gift_for_muslim.level",
                    " page ",
                    "$beginning.lessons.gift_for_muslim.page",
                    " → ",
                    "$ending.lessons.gift_for_muslim.level",
                    " page ",
                    "$ending.lessons.gift_for_muslim.page",
                  ],
                },
                "N/A",
              ],
            },
            // FIXED: Show beginning and ending target instead of subtraction
            target_display: {
              $cond: [
                {
                  $and: [
                    "$beginning.lessons.gift_for_muslim.target",
                    "$ending.lessons.gift_for_muslim.target",
                  ],
                },
                {
                  $concat: [
                    {
                      $ifNull: [
                        "$beginning.lessons.gift_for_muslim.target",
                        "Start",
                      ],
                    },
                    " → ",
                    {
                      $ifNull: [
                        "$ending.lessons.gift_for_muslim.target",
                        "End",
                      ],
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
                    "$beginning.lessons.gift_for_muslim.level",
                    "$ending.lessons.gift_for_muslim.level",
                  ],
                },
                {
                  $concat: [
                    {
                      $ifNull: [
                        "$beginning.lessons.gift_for_muslim.level",
                        "Start",
                      ],
                    },
                    " → ",
                    {
                      $ifNull: ["$ending.lessons.gift_for_muslim.level", "End"],
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
                        "Start",
                      ],
                    },
                    " → ",
                    {
                      $ifNull: [
                        "$ending.lessons.gift_for_muslim.lesson_name",
                        "End",
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
          input: ["$beginning.original_id", "$ending.original_id"],
          as: "id",
          cond: { $ne: ["$$id", null] },
        },
      },
      isUnpublished: { $literal: true },
    },
  },

  // Lookup related data
  lookupRelatedData: {
    $lookup: {
      from: "students",
      localField: "student_id",
      foreignField: "_id",
      as: "student_info",
    },
  },

  unwindStudent: {
    $unwind: {
      path: "$student_info",
      preserveNullAndEmptyArrays: true,
    },
  },

  lookupClass: {
    $lookup: {
      from: "classes",
      localField: "class_id",
      foreignField: "_id",
      as: "class_info",
    },
  },

  unwindClass: {
    $unwind: {
      path: "$class_info",
      preserveNullAndEmptyArrays: true,
    },
  },

  lookupTeacher: {
    $lookup: {
      from: "teachers",
      localField: "teacher_id",
      foreignField: "_id",
      as: "teacher_info",
    },
  },

  unwindTeacher: {
    $unwind: {
      path: "$teacher_info",
      preserveNullAndEmptyArrays: true,
    },
  },

  // Final projection
  finalProjection: {
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
      gift_for_muslim_progress: 1,
      processedDocumentIds: 1,
      isUnpublished: 1,
    },
  },
};

// Make commonYearlyPipelineStages a function that accepts year parameter
export const getCommonYearlyPipelineStages = (year) => ({
  // Initial grouping by student, month, class
  initialGrouping: {
    $group: {
      _id: {
        student_id: "$student_id",
        month: "$month",
        class_id: "$class_id",
        teacher_id: "$teacher_id",
      },
      entries: {
        $push: {
          time_of_month: "$time_of_month",
          lessons: "$lessons",
          type: "$type",
          original_id: "$original_id",
          teacher_id: "$teacher_id",
        },
      },
      document_ids: { $addToSet: "$original_id" },
      teacher_id: { $first: "$teacher_id" },
    },
  },

  // Separate beginning and ending entries
  separateMonthlyEntries: {
    $project: {
      _id: 0,
      student_id: "$_id.student_id",
      month: "$_id.month",
      class_id: "$_id.class_id",
      teacher_id: 1,
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

  // Filter complete pairs
  filterCompleteMonthlyPairs: {
    $match: {
      $and: [{ beginning: { $ne: null } }, { ending: { $ne: null } }],
    },
  },

  // Calculate monthly progress for all lesson types - THIS WAS MISSING!
  calculateMonthlyProgress: {
    $project: {
      student_id: 1,
      month: 1,
      class_id: 1,
      teacher_id: 1,
      document_ids: 1,
      type: {
        $cond: [
          { $ne: ["$ending.type", null] },
          "$ending.type",
          "$beginning.type",
        ],
      },

      // Qaidah/Quran monthly progress
      qaidah_quran_monthly: {
        $cond: [
          {
            $and: [
              "$beginning.lessons.qaidah_quran",
              "$ending.lessons.qaidah_quran",
            ],
          },
          {
            selected: "$ending.lessons.qaidah_quran.selected",
            page_progress: {
              $cond: [
                {
                  $and: [
                    "$beginning.lessons.qaidah_quran.data.page",
                    "$ending.lessons.qaidah_quran.data.page",
                  ],
                },
                {
                  // For Quran/Hifz: Show "Juz X page Y → Juz A page B"
                  $cond: [
                    {
                      $in: [
                        "$ending.lessons.qaidah_quran.selected",
                        ["quran", "hifz"],
                      ],
                    },
                    {
                      $cond: [
                        {
                          $and: [
                            "$beginning.lessons.qaidah_quran.data.para",
                            "$ending.lessons.qaidah_quran.data.para",
                          ],
                        },
                        {
                          $concat: [
                            "Juz ",
                            "$beginning.lessons.qaidah_quran.data.para",
                            " page ",
                            "$beginning.lessons.qaidah_quran.data.page",
                            " → Juz ",
                            "$ending.lessons.qaidah_quran.data.para",
                            " page ",
                            "$ending.lessons.qaidah_quran.data.page",
                          ],
                        },
                        {
                          $concat: [
                            "page ",
                            "$beginning.lessons.qaidah_quran.data.page",
                            " → page ",
                            "$ending.lessons.qaidah_quran.data.page",
                          ],
                        },
                      ],
                    },
                    // For Qaidah/Tajweed: Show "Level X page Y → Level A page B"
                    {
                      $cond: [
                        {
                          $and: [
                            "$beginning.lessons.qaidah_quran.data.level",
                            "$ending.lessons.qaidah_quran.data.level",
                          ],
                        },
                        {
                          $concat: [
                            "$beginning.lessons.qaidah_quran.data.level",
                            " page ",
                            "$beginning.lessons.qaidah_quran.data.page",
                            " → ",
                            "$ending.lessons.qaidah_quran.data.level",
                            " page ",
                            "$ending.lessons.qaidah_quran.data.page",
                          ],
                        },
                        {
                          $concat: [
                            "page ",
                            "$beginning.lessons.qaidah_quran.data.page",
                            " → page ",
                            "$ending.lessons.qaidah_quran.data.page",
                          ],
                        },
                      ],
                    },
                  ],
                },
                "N/A",
              ],
            },
            // Add numeric value for aggregation
            page_progress_numeric: {
              $let: {
                vars: {
                  startPage: {
                    $ifNull: [
                      {
                        $convert: {
                          input: "$beginning.lessons.qaidah_quran.data.page",
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
            para_progress: {
              $cond: [
                {
                  $and: [
                    "$beginning.lessons.qaidah_quran.data.para",
                    "$ending.lessons.qaidah_quran.data.para",
                  ],
                },
                {
                  $let: {
                    vars: {
                      startPara: {
                        $ifNull: [
                          {
                            $convert: {
                              input:
                                "$beginning.lessons.qaidah_quran.data.para",
                              to: "double",
                              onError: 0,
                              onNull: 0,
                            },
                          },
                          0,
                        ],
                      },
                      endPara: {
                        $ifNull: [
                          {
                            $convert: {
                              input: "$ending.lessons.qaidah_quran.data.para",
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
                      $subtract: ["$$endPara", "$$startPara"],
                    },
                  },
                },
                null,
              ],
            },
            beginning_page: {
              $ifNull: ["$beginning.lessons.qaidah_quran.data.page", "0"],
            },
            beginning_line: {
              $ifNull: ["$beginning.lessons.qaidah_quran.data.line", "0"],
            },
            ending_page: {
              $ifNull: ["$ending.lessons.qaidah_quran.data.page", "0"],
            },
            ending_line: {
              $ifNull: ["$ending.lessons.qaidah_quran.data.line", "0"],
            },
            beginning_level: "$beginning.lessons.qaidah_quran.data.level",
            ending_level: "$ending.lessons.qaidah_quran.data.level",
            beginning_lesson_name:
              "$beginning.lessons.qaidah_quran.data.lesson_name",
            ending_lesson_name: "$ending.lessons.qaidah_quran.data.lesson_name",
          },
          {
            page_progress: "N/A",
            page_progress_numeric: 0,
            para_progress: null,
            beginning_page: "0",
            beginning_line: "0",
            ending_page: "0",
            ending_line: "0",
            beginning_level: null,
            ending_level: null,
            beginning_lesson_name: null,
            ending_lesson_name: null,
          },
        ],
      },

      // Islamic Studies monthly progress
      islamic_studies_monthly: {
        $cond: [
          {
            $and: [
              "$beginning.lessons.islamic_studies",
              "$ending.lessons.islamic_studies",
              { $ne: ["$ending.type", "gift_muslim"] },
            ],
          },
          {
            page_progress: {
              $cond: [
                {
                  $and: [
                    "$beginning.lessons.islamic_studies.page",
                    "$ending.lessons.islamic_studies.page",
                    "$beginning.lessons.islamic_studies.book",
                    "$ending.lessons.islamic_studies.book",
                  ],
                },
                {
                  $concat: [
                    "$beginning.lessons.islamic_studies.book",
                    " page ",
                    "$beginning.lessons.islamic_studies.page",
                    " → ",
                    "$ending.lessons.islamic_studies.book",
                    " page ",
                    "$ending.lessons.islamic_studies.page",
                  ],
                },
                "N/A",
              ],
            },
            // Add numeric value for aggregation
            page_progress_numeric: {
              $let: {
                vars: {
                  startPage: {
                    $ifNull: [
                      {
                        $convert: {
                          input: "$beginning.lessons.islamic_studies.page",
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
                          input: "$ending.lessons.islamic_studies.page",
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
            beginning_book: "$beginning.lessons.islamic_studies.book",
            ending_book: "$ending.lessons.islamic_studies.book",
            beginning_lesson_name:
              "$beginning.lessons.islamic_studies.lesson_name",
            ending_lesson_name: "$ending.lessons.islamic_studies.lesson_name",
          },
          {
            page_progress: "N/A",
            page_progress_numeric: 0,
            beginning_book: null,
            ending_book: null,
            beginning_lesson_name: null,
            ending_lesson_name: null,
          },
        ],
      },

      // Dua/Surah monthly progress
      dua_surah_monthly: {
        $cond: [
          {
            $and: [
              "$beginning.lessons.dua_surah",
              "$ending.lessons.dua_surah",
              { $ne: ["$ending.type", "gift_muslim"] },
            ],
          },
          {
            page_progress: {
              $cond: [
                {
                  $and: [
                    "$beginning.lessons.dua_surah.page",
                    "$ending.lessons.dua_surah.page",
                    "$beginning.lessons.dua_surah.level",
                    "$ending.lessons.dua_surah.level",
                  ],
                },
                {
                  $concat: [
                    "$beginning.lessons.dua_surah.level",
                    " page ",
                    "$beginning.lessons.dua_surah.page",
                    " → ",
                    "$ending.lessons.dua_surah.level",
                    " page ",
                    "$ending.lessons.dua_surah.page",
                  ],
                },
                "N/A",
              ],
            },
            // Add numeric value for aggregation
            page_progress_numeric: {
              $let: {
                vars: {
                  startPage: {
                    $ifNull: [
                      {
                        $convert: {
                          input: "$beginning.lessons.dua_surah.page",
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
                          input: "$ending.lessons.dua_surah.page",
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
            beginning_target: "$beginning.lessons.dua_surah.target",
            ending_target: "$ending.lessons.dua_surah.target",
            dua_number_progress: {
              $let: {
                vars: {
                  startDua: {
                    $ifNull: [
                      {
                        $convert: {
                          input: "$beginning.lessons.dua_surah.dua_number",
                          to: "double",
                          onError: 0,
                          onNull: 0,
                        },
                      },
                      0,
                    ],
                  },
                  endDua: {
                    $ifNull: [
                      {
                        $convert: {
                          input: "$ending.lessons.dua_surah.dua_number",
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
                  $subtract: ["$$endDua", "$$startDua"],
                },
              },
            },
            beginning_book: "$beginning.lessons.dua_surah.book",
            ending_book: "$ending.lessons.dua_surah.book",
            beginning_level: "$beginning.lessons.dua_surah.level",
            ending_level: "$ending.lessons.dua_surah.level",
            beginning_lesson_name: "$beginning.lessons.dua_surah.lesson_name",
            ending_lesson_name: "$ending.lessons.dua_surah.lesson_name",
          },
          {
            page_progress: "N/A",
            page_progress_numeric: 0,
            beginning_target: null,
            ending_target: null,
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

      // Gift for Muslim monthly progress
      gift_for_muslim_monthly: {
        $cond: [
          {
            $and: [
              { $eq: ["$ending.type", "gift_muslim"] },
              "$beginning.lessons.gift_for_muslim",
              "$ending.lessons.gift_for_muslim",
            ],
          },
          {
            page_progress: {
              $cond: [
                {
                  $and: [
                    "$beginning.lessons.gift_for_muslim.page",
                    "$ending.lessons.gift_for_muslim.page",
                    "$beginning.lessons.gift_for_muslim.level",
                    "$ending.lessons.gift_for_muslim.level",
                  ],
                },
                {
                  $concat: [
                    "$beginning.lessons.gift_for_muslim.level",
                    " page ",
                    "$beginning.lessons.gift_for_muslim.page",
                    " → ",
                    "$ending.lessons.gift_for_muslim.level",
                    " page ",
                    "$ending.lessons.gift_for_muslim.page",
                  ],
                },
                "N/A",
              ],
            },
            // Add numeric value for aggregation
            page_progress_numeric: {
              $let: {
                vars: {
                  startPage: {
                    $ifNull: [
                      {
                        $convert: {
                          input: "$beginning.lessons.gift_for_muslim.page",
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
                          input: "$ending.lessons.gift_for_muslim.page",
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
            beginning_target: "$beginning.lessons.gift_for_muslim.target",
            ending_target: "$ending.lessons.gift_for_muslim.target",
            beginning_level: "$beginning.lessons.gift_for_muslim.level",
            ending_level: "$ending.lessons.gift_for_muslim.level",
            beginning_lesson_name:
              "$beginning.lessons.gift_for_muslim.lesson_name",
            ending_lesson_name: "$ending.lessons.gift_for_muslim.lesson_name",
          },
          {
            page_progress: "N/A",
            page_progress_numeric: 0,
            beginning_target: null,
            ending_target: null,
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

  // Yearly aggregation
  yearlyAggregation: {
    $group: {
      _id: {
        student_id: "$student_id",
        class_id: "$class_id",
        type: "$type",
        year: { $literal: parseInt(year) },
      },
      processedDocumentIds: { $addToSet: "$document_ids" },
      teacher_id: { $first: "$teacher_id" },

      // Use page_progress_numeric for numeric aggregation
      qaidah_quran_yearly: {
        $sum: "$qaidah_quran_monthly.page_progress_numeric",
      },
      islamic_studies_yearly: {
        $sum: "$islamic_studies_monthly.page_progress_numeric",
      },
      dua_surah_pages_yearly: {
        $sum: "$dua_surah_monthly.page_progress_numeric",
      },
      gift_for_muslim_pages_yearly: {
        $sum: "$gift_for_muslim_monthly.page_progress_numeric",
      },
      // Sum up yearly progress for numeric fields
      qaidah_quran_para_yearly: { $sum: "$qaidah_quran_monthly.para_progress" },
      dua_surah_numbers_yearly: {
        $sum: "$dua_surah_monthly.dua_number_progress",
      },

      // Get the first and last values for text fields
      first_qaidah_level: { $first: "$qaidah_quran_monthly.beginning_level" },
      last_qaidah_level: { $last: "$qaidah_quran_monthly.ending_level" },
      first_qaidah_lesson: {
        $first: "$qaidah_quran_monthly.beginning_lesson_name",
      },
      last_qaidah_lesson: { $last: "$qaidah_quran_monthly.ending_lesson_name" },
      qaidah_selected: { $first: "$qaidah_quran_monthly.selected" },
      first_qaidah_page: { $first: "$qaidah_quran_monthly.beginning_page" },
      first_qaidah_line: { $first: "$qaidah_quran_monthly.beginning_line" },
      last_qaidah_page: { $last: "$qaidah_quran_monthly.ending_page" },
      last_qaidah_line: { $last: "$qaidah_quran_monthly.ending_line" },
      first_islamic_book: { $first: "$islamic_studies_monthly.beginning_book" },
      last_islamic_book: { $last: "$islamic_studies_monthly.ending_book" },
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
      first_dua_lesson: { $first: "$dua_surah_monthly.beginning_lesson_name" },
      last_dua_lesson: { $last: "$dua_surah_monthly.ending_lesson_name" },
      first_dua_target: { $first: "$dua_surah_monthly.beginning_target" },
      last_dua_target: { $last: "$dua_surah_monthly.ending_target" },
      first_gift_level: { $first: "$gift_for_muslim_monthly.beginning_level" },
      last_gift_level: { $last: "$gift_for_muslim_monthly.ending_level" },
      first_gift_lesson: {
        $first: "$gift_for_muslim_monthly.beginning_lesson_name",
      },
      last_gift_lesson: {
        $last: "$gift_for_muslim_monthly.ending_lesson_name",
      },
      first_gift_target: {
        $first: "$gift_for_muslim_monthly.beginning_target",
      },
      last_gift_target: { $last: "$gift_for_muslim_monthly.ending_target" },
      first_qaidah_para: { $first: "$qaidah_quran_monthly.beginning_para" },
      last_qaidah_para: { $last: "$qaidah_quran_monthly.ending_para" },
      months_with_ending: { $sum: 1 },
      months_with_both: {
        $sum: {
          $cond: [{ $eq: ["$hasBeginning", true] }, 1, 0],
        },
      },
    },
  },

  // Filter months with both entries
  filterMonthsWithBoth: {
    $match: {
      months_with_both: { $gt: 0 },
    },
  },

  // Create yearly progress structure - FIXED FOR STRING DISPLAY
  // Create yearly progress structure - FIXED FOR STRING DISPLAY
  createYearlyProgress: {
    $project: {
      _id: 0,
      student_id: "$_id.student_id",
      class_id: "$_id.class_id",
      teacher_id: 1,
      type: "$_id.type",
      year: "$_id.year",
      processedDocumentIds: {
        $reduce: {
          input: "$processedDocumentIds",
          initialValue: [],
          in: { $setUnion: ["$$value", "$$this"] },
        },
      },

      // Create the proper structure based on type with STRING page_progress
      progress: {
        $cond: [
          { $eq: ["$_id.type", "gift_muslim"] },
          {
            qaidah_quran_progress: {
              $cond: [
                {
                  $or: [
                    { $ne: ["$first_qaidah_level", null] },
                    { $ne: ["$last_qaidah_level", null] },
                    { $ne: ["$first_qaidah_page", "0"] }, // ADD THIS
                    { $ne: ["$last_qaidah_page", "0"] }, // ADD THIS
                    { $ne: ["$qaidah_selected", null] }, // ADD THIS
                  ],
                },
                {
                  selected: "$qaidah_selected",
                  // Use string format for page_progress
                  page_progress: {
                    $cond: [
                      {
                        $and: [
                          { $ne: ["$first_qaidah_page", "0"] },
                          { $ne: ["$last_qaidah_page", "0"] },
                        ],
                      },
                      {
                        // For Quran/Hifz: Show "Juz X page Y → Juz A page B"
                        // For Quran/Hifz: Show "Juz X page Y → Juz A page B"
                        $cond: [
                          {
                            $in: ["$qaidah_selected", ["quran", "hifz"]],
                          },
                          {
                            $cond: [
                              {
                                $and: [
                                  "$first_qaidah_para", // Use para instead of level
                                  "$last_qaidah_para",
                                ],
                              },
                              {
                                $concat: [
                                  "Juz ",
                                  "$first_qaidah_para", // Use para instead of level
                                  " page ",
                                  "$first_qaidah_page",
                                  " → Juz ",
                                  "$last_qaidah_para", // Use para instead of level
                                  " page ",
                                  "$last_qaidah_page",
                                ],
                              },
                              {
                                $concat: [
                                  "page ",
                                  "$first_qaidah_page",
                                  " → page ",
                                  "$last_qaidah_page",
                                ],
                              },
                            ],
                          },
                          // For Qaidah/Tajweed: Show "Level X page Y → Level A page B"
                          {
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
                                  " page ",
                                  "$first_qaidah_page",
                                  " → ",
                                  "$last_qaidah_level",
                                  " page ",
                                  "$last_qaidah_page",
                                ],
                              },
                              {
                                $concat: [
                                  "page ",
                                  "$first_qaidah_page",
                                  " → page ",
                                  "$last_qaidah_page",
                                ],
                              },
                            ],
                          },
                        ],
                      },
                      "N/A",
                    ],
                  },
                  line_progress: {
                    $cond: [
                      {
                        $and: [
                          { $ne: ["$first_qaidah_page", "0"] },
                          { $ne: ["$last_qaidah_page", "0"] },
                        ],
                      },
                      {
                        $concat: [
                          "page ",
                          "$first_qaidah_page",
                          " line ",
                          "$first_qaidah_line",
                          " - page ",
                          "$last_qaidah_page",
                          " line ",
                          "$last_qaidah_line",
                        ],
                      },
                      "N/A",
                    ],
                  },
                  // FIX: Only show para_progress for Quran/Hifz
                  para_progress: {
                    $cond: [
                      {
                        $and: [
                          { $ne: ["$qaidah_quran_para_yearly", null] },
                          { $ne: ["$qaidah_quran_para_yearly", 0] },
                          {
                            $in: ["$qaidah_selected", ["quran", "hifz"]],
                          },
                        ],
                      },
                      "$qaidah_quran_para_yearly",
                      null,
                    ],
                  },
                  level_display: {
                    $cond: [
                      { $and: ["$first_qaidah_level", "$last_qaidah_level"] },
                      {
                        $concat: [
                          "$first_qaidah_level",
                          " → ",
                          "$last_qaidah_level",
                        ],
                      },
                      "N/A",
                    ],
                  },
                  lesson_name_display: {
                    $cond: [
                      { $and: ["$first_qaidah_lesson", "$last_qaidah_lesson"] },
                      {
                        $concat: [
                          "$first_qaidah_lesson",
                          " → ",
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
                    { $ne: ["$first_gift_level", null] },
                    { $ne: ["$last_gift_level", null] },
                  ],
                },
                {
                  // Use string format for page_progress
                  page_progress: {
                    $cond: [
                      {
                        $and: [
                          "$first_gift_level",
                          "$last_gift_level",
                          "$first_gift_target",
                          "$last_gift_target",
                        ],
                      },
                      {
                        $concat: [
                          "$first_gift_level",
                          " page ",
                          "$first_gift_target",
                          " → ",
                          "$last_gift_level",
                          " page ",
                          "$last_gift_target",
                        ],
                      },
                      "N/A",
                    ],
                  },
                  target_display: {
                    $cond: [
                      { $and: ["$first_gift_target", "$last_gift_target"] },
                      {
                        $concat: [
                          "$first_gift_target",
                          " → ",
                          "$last_gift_target",
                        ],
                      },
                      "N/A",
                    ],
                  },
                  level_display: {
                    $cond: [
                      { $and: ["$first_gift_level", "$last_gift_level"] },
                      {
                        $concat: [
                          "$first_gift_level",
                          " → ",
                          "$last_gift_level",
                        ],
                      },
                      "N/A",
                    ],
                  },
                  lesson_name_display: {
                    $cond: [
                      { $and: ["$first_gift_lesson", "$last_gift_lesson"] },
                      {
                        $concat: [
                          "$first_gift_lesson",
                          " → ",
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
          // ... rest of the non-gift_muslim section remains the same
          {
            qaidah_quran_progress: {
              $cond: [
                {
                  $or: [
                    { $ne: ["$first_qaidah_level", null] },
                    { $ne: ["$last_qaidah_level", null] },
                    { $ne: ["$first_qaidah_page", "0"] }, // ADD THIS
                    { $ne: ["$last_qaidah_page", "0"] }, // ADD THIS
                    { $ne: ["$qaidah_selected", null] }, // ADD THIS
                  ],
                },
                {
                  selected: "$qaidah_selected",
                  // Use string format for page_progress
                  page_progress: {
                    $cond: [
                      {
                        $and: [
                          { $ne: ["$first_qaidah_page", "0"] },
                          { $ne: ["$last_qaidah_page", "0"] },
                        ],
                      },
                      {
                        // For Quran/Hifz: Show "Juz X page Y → Juz A page B"
                        $cond: [
                          {
                            $in: ["$qaidah_selected", ["quran", "hifz"]],
                          },
                          {
                            $cond: [
                              {
                                $and: [
                                  "$first_qaidah_level",
                                  "$last_qaidah_level",
                                ],
                              },
                              {
                                $concat: [
                                  "Juz ",
                                  "$first_qaidah_level",
                                  " page ",
                                  "$first_qaidah_page",
                                  " → Juz ",
                                  "$last_qaidah_level",
                                  " page ",
                                  "$last_qaidah_page",
                                ],
                              },
                              {
                                $concat: [
                                  "page ",
                                  "$first_qaidah_page",
                                  " → page ",
                                  "$last_qaidah_page",
                                ],
                              },
                            ],
                          },
                          // For Qaidah/Tajweed: Show "Level X page Y → Level A page B"
                          {
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
                                  " page ",
                                  "$first_qaidah_page",
                                  " → ",
                                  "$last_qaidah_level",
                                  " page ",
                                  "$last_qaidah_page",
                                ],
                              },
                              {
                                $concat: [
                                  "page ",
                                  "$first_qaidah_page",
                                  " → page ",
                                  "$last_qaidah_page",
                                ],
                              },
                            ],
                          },
                        ],
                      },
                      "N/A",
                    ],
                  },
                  line_progress: {
                    $cond: [
                      {
                        $and: [
                          { $ne: ["$first_qaidah_page", "0"] },
                          { $ne: ["$last_qaidah_page", "0"] },
                        ],
                      },
                      {
                        $concat: [
                          "page ",
                          "$first_qaidah_page",
                          " line ",
                          "$first_qaidah_line",
                          " - page ",
                          "$last_qaidah_page",
                          " line ",
                          "$last_qaidah_line",
                        ],
                      },
                      "N/A",
                    ],
                  },
                  // FIX: Only show para_progress for Quran/Hifz
                  para_progress: {
                    $cond: [
                      {
                        $and: [
                          { $ne: ["$qaidah_quran_para_yearly", null] },
                          { $ne: ["$qaidah_quran_para_yearly", 0] },
                          {
                            $in: ["$qaidah_selected", ["quran", "hifz"]],
                          },
                        ],
                      },
                      "$qaidah_quran_para_yearly",
                      null,
                    ],
                  },
                  level_display: {
                    $cond: [
                      { $and: ["$first_qaidah_level", "$last_qaidah_level"] },
                      {
                        $concat: [
                          "$first_qaidah_level",
                          " → ",
                          "$last_qaidah_level",
                        ],
                      },
                      "N/A",
                    ],
                  },
                  lesson_name_display: {
                    $cond: [
                      { $and: ["$first_qaidah_lesson", "$last_qaidah_lesson"] },
                      {
                        $concat: [
                          "$first_qaidah_lesson",
                          " → ",
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
                    { $ne: ["$first_islamic_book", null] },
                    { $ne: ["$last_islamic_book", null] },
                  ],
                },
                {
                  // Use string format for page_progress
                  page_progress: {
                    $cond: [
                      {
                        $and: [
                          "$first_islamic_book",
                          "$last_islamic_book",
                          "$first_qaidah_page",
                          "$last_qaidah_page",
                        ],
                      },
                      {
                        $concat: [
                          "$first_islamic_book",
                          " page ",
                          "$first_qaidah_page",
                          " → ",
                          "$last_islamic_book",
                          " page ",
                          "$last_qaidah_page",
                        ],
                      },
                      "N/A",
                    ],
                  },
                  book_display: {
                    $cond: [
                      { $and: ["$first_islamic_book", "$last_islamic_book"] },
                      {
                        $concat: [
                          "$first_islamic_book",
                          " → ",
                          "$last_islamic_book",
                        ],
                      },
                      "N/A",
                    ],
                  },
                  lesson_name_display: {
                    $cond: [
                      {
                        $and: ["$first_islamic_lesson", "$last_islamic_lesson"],
                      },
                      {
                        $concat: [
                          "$first_islamic_lesson",
                          " → ",
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
                    { $ne: ["$first_dua_book", null] },
                    { $ne: ["$last_dua_book", null] },
                  ],
                },
                {
                  // Use string format for page_progress
                  page_progress: {
                    $cond: [
                      {
                        $and: [
                          "$first_dua_level",
                          "$last_dua_level",
                          "$first_dua_target",
                          "$last_dua_target",
                        ],
                      },
                      {
                        $concat: [
                          "$first_dua_level",
                          " page ",
                          "$first_dua_target",
                          " → ",
                          "$last_dua_level",
                          " page ",
                          "$last_dua_target",
                        ],
                      },
                      "N/A",
                    ],
                  },
                  target_display: {
                    $cond: [
                      { $and: ["$first_dua_target", "$last_dua_target"] },
                      {
                        $concat: [
                          "$first_dua_target",
                          " → ",
                          "$last_dua_target",
                        ],
                      },
                      "N/A",
                    ],
                  },
                  dua_number_progress: "$dua_surah_numbers_yearly",
                  book_display: {
                    $cond: [
                      { $and: ["$first_dua_book", "$last_dua_book"] },
                      { $concat: ["$first_dua_book", " → ", "$last_dua_book"] },
                      "N/A",
                    ],
                  },
                  level_display: {
                    $cond: [
                      { $and: ["$first_dua_level", "$last_dua_level"] },
                      {
                        $concat: ["$first_dua_level", " → ", "$last_dua_level"],
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
                          " → ",
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

  // Final projection with related data
  finalYearlyProjection: {
    $project: {
      student_id: 1,
      student_name: "$student_info.name",
      year: 1,
      type: 1,
      processedDocumentIds: 1,
      class_name: "$class_info.class_name",
      teacher_name: "$teacher_info.name",
      progress: 1,
      months_with_ending: 1,
      months_with_both: 1,
    },
  },
});

// Generic yearly pipeline builder
const buildGenericYearlyPipeline = (matchStage, year, isStudent = false) => {
  const yearlyStages = getCommonYearlyPipelineStages(year);

  const pipeline = [
    { $match: matchStage },
    commonPipelineStages.convertIds,
    yearlyStages.initialGrouping,
    yearlyStages.separateMonthlyEntries,
    yearlyStages.filterCompleteMonthlyPairs,
    yearlyStages.calculateMonthlyProgress,
    yearlyStages.yearlyAggregation,
    yearlyStages.filterMonthsWithBoth,
    yearlyStages.createYearlyProgress,
  ];

  // Add lookups based on user type
  if (!isStudent) {
    pipeline.push(
      commonPipelineStages.lookupRelatedData,
      commonPipelineStages.unwindStudent,
      commonPipelineStages.lookupClass,
      commonPipelineStages.unwindClass,
      commonPipelineStages.lookupTeacher,
      commonPipelineStages.unwindTeacher,
      yearlyStages.finalYearlyProjection
    );
  } else {
    pipeline.push(
      {
        $lookup: {
          from: "students",
          localField: "student_id",
          foreignField: "student_id",
          as: "student_info",
        },
      },
      { $unwind: { path: "$student_info", preserveNullAndEmptyArrays: true } },
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
          ...yearlyStages.finalYearlyProjection.$project,
          isPublished: { $literal: true },
        },
      }
    );
  }

  return pipeline;
};
// Function to build monthly summary pipeline
export const buildMonthlySummaryPipeline = (matchConditions) => [
  { $match: matchConditions },
  commonPipelineStages.convertIds,
  commonPipelineStages.groupAndSeparate({
    student_id: "$student_id",
    month: "$month",
    year: "$year",
  }),
  commonPipelineStages.separateEntries,
  commonPipelineStages.filterCompletePairs,
  commonPipelineStages.calculateProgress,
  commonPipelineStages.lookupRelatedData,
  commonPipelineStages.unwindStudent,
  commonPipelineStages.lookupClass,
  commonPipelineStages.unwindClass,
  commonPipelineStages.lookupTeacher,
  commonPipelineStages.unwindTeacher,
  commonPipelineStages.finalProjection,
];

export const buildYearlySummaryPipeline = (year) => {
  if (!year) throw new Error("Year parameter is required");

  return buildGenericYearlyPipeline(
    {
      year: year,
      $or: [{ yearly_publish: { $exists: false } }, { yearly_publish: false }],
    },
    year
  );
};

export const buildTeacherMonthlySummaryPipeline = (matchConditions) => [
  { $match: matchConditions },
  commonPipelineStages.convertIds,
  commonPipelineStages.groupAndSeparate({
    student_id: "$student_id",
    month: "$month",
    year: "$year",
  }),
  commonPipelineStages.separateEntries,
  commonPipelineStages.filterCompletePairs,
  commonPipelineStages.calculateProgress,
  commonPipelineStages.lookupRelatedData,
  commonPipelineStages.unwindStudent,
  commonPipelineStages.lookupClass,
  commonPipelineStages.unwindClass,
  commonPipelineStages.lookupTeacher,
  commonPipelineStages.unwindTeacher,
  commonPipelineStages.finalProjection,
];

export const buildTeacherYearlySummaryPipeline = (teacher_id, year) => {
  if (!year) throw new Error("Year parameter is required");

  return buildGenericYearlyPipeline(
    {
      teacher_id: teacher_id,
      year: year,
      $or: [{ yearly_publish: { $exists: false } }, { yearly_publish: false }],
    },
    year
  );
};

export const buildStudentMonthlySummaryPipeline = (matchConditions) => [
  { $match: matchConditions },
  commonPipelineStages.convertIds,
  commonPipelineStages.groupAndSeparate({
    student_id: "$student_id",
    month: "$month",
    year: "$year",
  }),
  commonPipelineStages.separateEntries,
  commonPipelineStages.filterCompletePairs,
  commonPipelineStages.calculateProgress,
  commonPipelineStages.lookupRelatedData,
  commonPipelineStages.unwindStudent,
  commonPipelineStages.lookupClass,
  commonPipelineStages.unwindClass,
  commonPipelineStages.lookupTeacher,
  commonPipelineStages.unwindTeacher,
  commonPipelineStages.finalProjection,
];

export const buildStudentYearlySummaryPipeline = (studentIdsArray, year) => {
  if (!year) throw new Error("Year parameter is required");

  return buildGenericYearlyPipeline(
    {
      student_id: { $in: studentIdsArray },
      year: year,
      yearly_publish: true,
    },
    year,
    true // isStudent flag
  );
};
