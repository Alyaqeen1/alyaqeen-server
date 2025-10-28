// utils/lessonsCoveredUtils.js

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

      // Qaidah/Quran progress
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

      // Islamic Studies progress
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

      // Dua/Surah progress
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
            target_progress: {
              $let: {
                vars: {
                  startTarget: {
                    $ifNull: [
                      {
                        $convert: {
                          input: "$beginning.lessons.dua_surah.target",
                          to: "double",
                          onError: 0,
                          onNull: 0,
                        },
                      },
                      0,
                    ],
                  },
                  endTarget: {
                    $ifNull: [
                      {
                        $convert: {
                          input: "$ending.lessons.dua_surah.target",
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
                  $subtract: ["$$endTarget", "$$startTarget"],
                },
              },
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

      // Gift for Muslim progress
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
            target_progress: {
              $let: {
                vars: {
                  startTarget: {
                    $ifNull: [
                      {
                        $convert: {
                          input: "$beginning.lessons.gift_for_muslim.target",
                          to: "double",
                          onError: 0,
                          onNull: 0,
                        },
                      },
                      0,
                    ],
                  },
                  endTarget: {
                    $ifNull: [
                      {
                        $convert: {
                          input: "$ending.lessons.gift_for_muslim.target",
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
                  $subtract: ["$$endTarget", "$$startTarget"],
                },
              },
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

// Function to build monthly summary pipeline
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

// Function to build complete yearly summary pipeline
export const buildYearlySummaryPipeline = (year) => {
  if (!year) {
    throw new Error("Year parameter is required");
  }

  return [
    {
      $match: {
        year: year,
        $or: [
          { yearly_publish: { $exists: false } },
          { yearly_publish: false },
        ],
      },
    },
    commonPipelineStages.convertIds,
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
            teacher_id: "$teacher_id",
          },
        },
        document_ids: { $addToSet: "$original_id" },
        teacher_id: { $first: "$teacher_id" },
      },
    },
    {
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
    // Only include months that have BOTH beginning AND ending
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
        teacher_id: 1,
        document_ids: 1,
        type: {
          $cond: [
            { $ne: ["$ending.type", null] },
            "$ending.type",
            "$beginning.type",
          ],
        },

        // Calculate monthly progress for each lesson type
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
              line_progress: {
                $let: {
                  vars: {
                    startPage: {
                      $ifNull: [
                        "$beginning.lessons.qaidah_quran.data.page",
                        "0",
                      ],
                    },
                    startLine: {
                      $ifNull: [
                        "$beginning.lessons.qaidah_quran.data.line",
                        "0",
                      ],
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
              beginning_level: "$beginning.lessons.qaidah_quran.data.level",
              ending_level: "$ending.lessons.qaidah_quran.data.level",
              beginning_lesson_name:
                "$beginning.lessons.qaidah_quran.data.lesson_name",
              ending_lesson_name:
                "$ending.lessons.qaidah_quran.data.lesson_name",
            },
            {
              page_progress: 0,
              line_progress: "page 0 line 0 - page 0 line 0",
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
                "$beginning.lessons.islamic_studies",
                "$ending.lessons.islamic_studies",
                { $ne: ["$ending.type", "gift_muslim"] },
              ],
            },
            {
              page_progress: {
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
                "$beginning.lessons.dua_surah",
                "$ending.lessons.dua_surah",
                { $ne: ["$ending.type", "gift_muslim"] },
              ],
            },
            {
              page_progress: {
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
              target_progress: {
                $let: {
                  vars: {
                    startTarget: {
                      $ifNull: [
                        {
                          $convert: {
                            input: "$beginning.lessons.dua_surah.target",
                            to: "double",
                            onError: 0,
                            onNull: 0,
                          },
                        },
                        0,
                      ],
                    },
                    endTarget: {
                      $ifNull: [
                        {
                          $convert: {
                            input: "$ending.lessons.dua_surah.target",
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
                    $subtract: ["$$endTarget", "$$startTarget"],
                  },
                },
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
              beginning_book: "$beginning.lessons.dua_surah.book",
              ending_book: "$ending.lessons.dua_surah.book",
              beginning_level: "$beginning.lessons.dua_surah.level",
              ending_level: "$ending.lessons.dua_surah.level",
              beginning_lesson_name: "$beginning.lessons.dua_surah.lesson_name",
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
                { $eq: ["$ending.type", "gift_muslim"] },
                "$beginning.lessons.gift_for_muslim",
                "$ending.lessons.gift_for_muslim",
              ],
            },
            {
              page_progress: {
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
              target_progress: {
                $let: {
                  vars: {
                    startTarget: {
                      $ifNull: [
                        {
                          $convert: {
                            input: "$beginning.lessons.gift_for_muslim.target",
                            to: "double",
                            onError: 0,
                            onNull: 0,
                          },
                        },
                        0,
                      ],
                    },
                    endTarget: {
                      $ifNull: [
                        {
                          $convert: {
                            input: "$ending.lessons.gift_for_muslim.target",
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
                    $subtract: ["$$endTarget", "$$startTarget"],
                  },
                },
              },
              beginning_level: "$beginning.lessons.gift_for_muslim.level",
              ending_level: "$ending.lessons.gift_for_muslim.level",
              beginning_lesson_name:
                "$beginning.lessons.gift_for_muslim.lesson_name",
              ending_lesson_name: "$ending.lessons.gift_for_muslim.lesson_name",
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
        teacher_id: { $first: "$teacher_id" },

        // Sum up yearly progress for numeric fields
        qaidah_quran_yearly: {
          $sum: "$qaidah_quran_monthly.page_progress",
        },
        qaidah_quran_lines_yearly: {
          $sum: {
            $cond: [
              { $ne: ["$qaidah_quran_monthly.line_progress", null] },
              1,
              0,
            ],
          },
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
    // Only include students who have at least one complete month
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
                    line_progress: {
                      $concat: [
                        "Completed ",
                        { $toString: "$qaidah_quran_lines_yearly" },
                        " months with line progress",
                      ],
                    },
                    para_progress: "$qaidah_quran_para_yearly",
                    level_display: {
                      $cond: [
                        {
                          $and: ["$first_qaidah_level", "$last_qaidah_level"],
                        },
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
                        {
                          $and: ["$first_qaidah_lesson", "$last_qaidah_lesson"],
                        },
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
                            " → ",
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
                    line_progress: {
                      $concat: [
                        "Completed ",
                        { $toString: "$qaidah_quran_lines_yearly" },
                        " months with line progress",
                      ],
                    },
                    para_progress: "$qaidah_quran_para_yearly",
                    level_display: {
                      $cond: [
                        {
                          $and: ["$first_qaidah_level", "$last_qaidah_level"],
                        },
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
                        {
                          $and: ["$first_qaidah_lesson", "$last_qaidah_lesson"],
                        },
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
                      { $gt: ["$islamic_studies_yearly", 0] },
                      { $ne: ["$first_islamic_book", null] },
                    ],
                  },
                  {
                    page_progress: "$islamic_studies_yearly",
                    book_display: {
                      $cond: [
                        {
                          $and: ["$first_islamic_book", "$last_islamic_book"],
                        },
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
                          $and: [
                            "$first_islamic_lesson",
                            "$last_islamic_lesson",
                          ],
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
                          $concat: ["$first_dua_book", " → ", "$last_dua_book"],
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
                            " → ",
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
    commonPipelineStages.lookupRelatedData,
    commonPipelineStages.unwindStudent,
    commonPipelineStages.lookupClass,
    commonPipelineStages.unwindClass,
    commonPipelineStages.lookupTeacher,
    commonPipelineStages.unwindTeacher,
    {
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
  ];
};
