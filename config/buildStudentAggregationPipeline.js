const buildStudentAggregationPipeline = (match = {}) => [
  { $match: match },
  {
    $addFields: {
      deptObjectId: {
        $cond: [
          { $ne: ["$academic.dept_id", null] },
          { $toObjectId: "$academic.dept_id" },
          null,
        ],
      },
      classObjectId: {
        $cond: [
          { $ne: ["$academic.class_id", null] },
          { $toObjectId: "$academic.class_id" },
          null,
        ],
      },
    },
  },
  {
    $lookup: {
      from: "departments",
      localField: "deptObjectId",
      foreignField: "_id",
      as: "departmentInfo",
    },
  },
  {
    $lookup: {
      from: "classes",
      localField: "classObjectId",
      foreignField: "_id",
      as: "classInfo",
    },
  },
  {
    $addFields: {
      "academic.department": {
        $arrayElemAt: ["$departmentInfo.dept_name", 0],
      },
      "academic.class": {
        $arrayElemAt: ["$classInfo.class_name", 0],
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
