const buildStudentAggregationPipeline = (match = {}) => [
  {
    $match: {
      ...match,
      "academic.enrollments": { $exists: true, $type: "array" },
    },
  },
  {
    $addFields: {
      // Convert all enrollment dept_ids and class_ids to ObjectId
      enrollmentsWithObjectIds: {
        $map: {
          input: "$academic.enrollments",
          as: "enrollment",
          in: {
            $mergeObjects: [
              "$$enrollment",
              {
                deptObjectId: {
                  $cond: [
                    {
                      $and: [
                        { $ne: ["$$enrollment.dept_id", null] },
                        { $ne: ["$$enrollment.dept_id", ""] },
                        {
                          $or: [
                            {
                              $eq: [
                                { $type: "$$enrollment.dept_id" },
                                "string",
                              ],
                            },
                            {
                              $eq: [
                                { $type: "$$enrollment.dept_id" },
                                "objectId",
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    {
                      $convert: {
                        input: "$$enrollment.dept_id",
                        to: "objectId",
                        onError: null,
                        onNull: null,
                      },
                    },
                    null,
                  ],
                },
                classObjectId: {
                  $cond: [
                    {
                      $and: [
                        { $ne: ["$$enrollment.class_id", null] },
                        { $ne: ["$$enrollment.class_id", ""] },
                        {
                          $or: [
                            {
                              $eq: [
                                { $type: "$$enrollment.class_id" },
                                "string",
                              ],
                            },
                            {
                              $eq: [
                                { $type: "$$enrollment.class_id" },
                                "objectId",
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    {
                      $convert: {
                        input: "$$enrollment.class_id",
                        to: "objectId",
                        onError: null,
                        onNull: null,
                      },
                    },
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
  {
    $lookup: {
      from: "departments",
      localField: "enrollmentsWithObjectIds.deptObjectId",
      foreignField: "_id",
      as: "departmentInfo",
    },
  },
  {
    $lookup: {
      from: "classes",
      localField: "enrollmentsWithObjectIds.classObjectId",
      foreignField: "_id",
      as: "classInfo",
    },
  },
  {
    $addFields: {
      // Enrich each enrollment with department and class names
      "academic.enrollments": {
        $map: {
          input: "$enrollmentsWithObjectIds",
          as: "enrollment",
          in: {
            $mergeObjects: [
              "$$enrollment",
              {
                department: {
                  $let: {
                    vars: {
                      dept: {
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
                    in: { $ifNull: ["$$dept.dept_name", "Unknown Department"] },
                  },
                },
                class: {
                  $let: {
                    vars: {
                      cls: {
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
                    in: { $ifNull: ["$$cls.class_name", "Unknown Class"] },
                  },
                },
              },
            ],
          },
        },
      },
      // Calculate total monthly fee from all enrollments
      totalMonthlyFee: {
        $sum: {
          $map: {
            input: "$enrollmentsWithObjectIds",
            as: "enrollment",
            in: {
              $let: {
                vars: {
                  dept: {
                    $arrayElemAt: [
                      {
                        $filter: {
                          input: "$departmentInfo",
                          as: "dept",
                          cond: {
                            $eq: ["$$dept._id", "$$enrollment.deptObjectId"],
                          },
                        },
                      },
                      0,
                    ],
                  },
                },
                in: {
                  $cond: [
                    { $eq: ["$$enrollment.session", "weekend"] },
                    "$$dept.weekend_fee",
                    "$$dept.weekdays_fee",
                  ],
                },
              },
            },
          },
        },
      },
    },
  },
  {
    $project: {
      enrollmentsWithObjectIds: 0,
      departmentInfo: 0,
      classInfo: 0,
    },
  },
];

module.exports = buildStudentAggregationPipeline;
