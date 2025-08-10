const buildStudentAggregationPipeline = (match = {}) => [
  {
    $match: {
      ...match,
      $and: [
        {
          $or: [
            { "academic.dept_id": { $exists: false } },
            { "academic.dept_id": null },
            { "academic.dept_id": { $type: "string" } },
            { "academic.dept_id": { $type: "objectId" } },
          ],
        },
        {
          $or: [
            { "academic.class_id": { $exists: false } },
            { "academic.class_id": null },
            { "academic.class_id": { $type: "string" } },
            { "academic.class_id": { $type: "objectId" } },
          ],
        },
      ],
    },
  },
  {
    $addFields: {
      deptObjectId: {
        $cond: [
          {
            $and: [
              { $ne: ["$academic.dept_id", null] },
              {
                $or: [
                  { $eq: [{ $type: "$academic.dept_id" }, "string"] },
                  { $eq: [{ $type: "$academic.dept_id" }, "objectId"] },
                ],
              },
            ],
          },
          {
            $convert: {
              input: "$academic.dept_id",
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
              { $ne: ["$academic.class_id", null] },
              { $ne: ["$academic.class_id", ""] }, // avoid empty strings
              {
                $or: [
                  { $eq: [{ $type: "$academic.class_id" }, "string"] },
                  { $eq: [{ $type: "$academic.class_id" }, "objectId"] },
                ],
              },
            ],
          },
          {
            $convert: {
              input: "$academic.class_id",
              to: "objectId",
              onError: null,
              onNull: null,
            },
          },
          null,
        ],
      },
    },
  },
  {
    $lookup: {
      from: "departments",
      let: { deptId: "$deptObjectId" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $ne: ["$$deptId", null] },
                { $eq: ["$_id", "$$deptId"] },
              ],
            },
          },
        },
        { $project: { dept_name: 1 } },
      ],
      as: "departmentInfo",
    },
  },
  {
    $lookup: {
      from: "classes",
      let: { classId: "$classObjectId" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $ne: ["$$classId", null] },
                { $eq: ["$_id", "$$classId"] },
              ],
            },
          },
        },
        { $project: { class_name: 1 } },
      ],
      as: "classInfo",
    },
  },
  {
    $addFields: {
      "academic.department": {
        $ifNull: [
          { $arrayElemAt: ["$departmentInfo.dept_name", 0] },
          "Unknown Department",
        ],
      },
      "academic.class": {
        $ifNull: [
          { $arrayElemAt: ["$classInfo.class_name", 0] },
          "Unknown Class",
        ],
      },
    },
  },
  {
    $project: {
      departmentInfo: 0,
      classInfo: 0,
      deptObjectId: 0,
      classObjectId: 0,
    },
  },
];

module.exports = buildStudentAggregationPipeline;
