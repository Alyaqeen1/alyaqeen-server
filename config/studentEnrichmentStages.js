const studentEnrichmentStages = () => [
  // Handle both old and new structures by normalizing to enrollments array
  {
    $addFields: {
      // Normalize academic structure to always use enrollments array
      normalizedAcademic: {
        $cond: {
          if: {
            $and: [
              { $isArray: "$academic.enrollments" },
              { $gt: [{ $size: "$academic.enrollments" }, 0] },
            ],
          },
          then: "$academic", // Already has enrollments array (new structure)
          else: {
            // Convert old structure to new format
            enrollments: [
              {
                dept_id: "$academic.dept_id",
                class_id: "$academic.class_id",
                session: "$academic.session",
                session_time: "$academic.time",
                department: "$academic.department",
                class: "$academic.class",
              },
            ],
          },
        },
      },
    },
  },
  // Add ObjectId conversions for each enrollment
  {
    $addFields: {
      "normalizedAcademic.enrollments": {
        $map: {
          input: "$normalizedAcademic.enrollments",
          as: "enrollment",
          in: {
            $mergeObjects: [
              "$$enrollment",
              {
                deptObjectId: {
                  $cond: [
                    {
                      $and: [
                        { $ifNull: ["$$enrollment.dept_id", false] },
                        { $ne: ["$$enrollment.dept_id", ""] },
                        { $ne: ["$$enrollment.dept_id", null] },
                      ],
                    },
                    { $toObjectId: "$$enrollment.dept_id" },
                    null,
                  ],
                },
                classObjectId: {
                  $cond: [
                    {
                      $and: [
                        { $ifNull: ["$$enrollment.class_id", false] },
                        { $ne: ["$$enrollment.class_id", ""] },
                        { $ne: ["$$enrollment.class_id", null] },
                      ],
                    },
                    { $toObjectId: "$$enrollment.class_id" },
                    null,
                  ],
                },
              },
            ],
          },
        },
      },
    },
  },
  // Lookup all departments needed
  {
    $lookup: {
      from: "departments",
      let: { enrollments: "$normalizedAcademic.enrollments" },
      pipeline: [
        {
          $match: {
            $expr: {
              $in: ["$_id", "$$enrollments.deptObjectId"],
            },
          },
        },
        {
          $project: {
            _id: 1,
            dept_name: 1,
            weekdays_fee: 1,
            weekend_fee: 1,
          },
        },
      ],
      as: "departmentInfo",
    },
  },
  // Lookup all classes needed
  {
    $lookup: {
      from: "classes",
      let: { enrollments: "$normalizedAcademic.enrollments" },
      pipeline: [
        {
          $match: {
            $expr: {
              $in: ["$_id", "$$enrollments.classObjectId"],
            },
          },
        },
        {
          $project: {
            _id: 1,
            class_name: 1,
            session: 1,
            session_time: 1,
          },
        },
      ],
      as: "classInfo",
    },
  },
  // Enrich each enrollment with department and class names
  {
    $addFields: {
      "normalizedAcademic.enrollments": {
        $map: {
          input: "$normalizedAcademic.enrollments",
          as: "enrollment",
          in: {
            $mergeObjects: [
              "$$enrollment",
              {
                department: {
                  $let: {
                    vars: {
                      matchedDept: {
                        $arrayElemAt: [
                          {
                            $filter: {
                              input: "$departmentInfo",
                              as: "dept",
                              cond: {
                                $eq: [
                                  "$$dept._id",
                                  "$$enrollment.deptObjectId",
                                ],
                              },
                            },
                          },
                          0,
                        ],
                      },
                    },
                    in: {
                      $ifNull: [
                        "$$matchedDept.dept_name",
                        "$$enrollment.department",
                        "Unknown Department",
                      ],
                    },
                  },
                },
                class: {
                  $let: {
                    vars: {
                      matchedClass: {
                        $arrayElemAt: [
                          {
                            $filter: {
                              input: "$classInfo",
                              as: "cls",
                              cond: {
                                $eq: [
                                  "$$cls._id",
                                  "$$enrollment.classObjectId",
                                ],
                              },
                            },
                          },
                          0,
                        ],
                      },
                    },
                    in: {
                      $ifNull: [
                        "$$matchedClass.class_name",
                        "$$enrollment.class",
                        "Unknown Class",
                      ],
                    },
                  },
                },
                // Calculate fee for this enrollment
                enrollmentFee: {
                  $let: {
                    vars: {
                      matchedDept: {
                        $arrayElemAt: [
                          {
                            $filter: {
                              input: "$departmentInfo",
                              as: "dept",
                              cond: {
                                $eq: [
                                  "$$dept._id",
                                  "$$enrollment.deptObjectId",
                                ],
                              },
                            },
                          },
                          0,
                        ],
                      },
                    },
                    in: {
                      $cond: {
                        if: { $eq: ["$$enrollment.session", "weekend"] },
                        then: { $ifNull: ["$$matchedDept.weekend_fee", 0] },
                        else: { $ifNull: ["$$matchedDept.weekdays_fee", 0] },
                      },
                    },
                  },
                },
              },
            ],
          },
        },
      },
    },
  },
  // Calculate total monthly fee from all enrollments
  {
    $addFields: {
      totalMonthlyFee: {
        $sum: "$normalizedAcademic.enrollments.enrollmentFee",
      },
    },
  },
  // Replace the original academic field with the normalized one
  {
    $addFields: {
      academic: "$normalizedAcademic",
    },
  },
  // Clean up temporary fields
  {
    $project: {
      normalizedAcademic: 0,
      departmentInfo: 0,
      classInfo: 0,
    },
  },
];

module.exports = studentEnrichmentStages;
