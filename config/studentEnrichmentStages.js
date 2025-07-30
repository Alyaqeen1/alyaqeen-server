const studentEnrichmentStages = () => [
  // Safely convert IDs to ObjectId if they exist
  {
    $addFields: {
      deptObjectId: {
        $cond: [
          {
            $and: [
              { $ifNull: ["$academic.dept_id", false] },
              { $ne: ["$academic.dept_id", ""] },
            ],
          },
          { $toObjectId: "$academic.dept_id" },
          null,
        ],
      },
      classObjectId: {
        $cond: [
          {
            $and: [
              { $ifNull: ["$academic.class_id", false] },
              { $ne: ["$academic.class_id", ""] },
            ],
          },
          { $toObjectId: "$academic.class_id" },
          null,
        ],
      },
    },
  },
  // Lookup department info if deptObjectId exists
  {
    $lookup: {
      from: "departments",
      localField: "deptObjectId",
      foreignField: "_id",
      as: "departmentInfo",
    },
  },
  // Lookup class info if classObjectId exists
  {
    $lookup: {
      from: "classes",
      localField: "classObjectId",
      foreignField: "_id",
      as: "classInfo",
    },
  },
  // Safely add enriched fields
  {
    $addFields: {
      "academic.department": {
        $ifNull: [
          { $arrayElemAt: ["$departmentInfo.dept_name", 0] },
          "$academic.department", // Keep existing if no lookup result
          null,
        ],
      },
      "academic.class": {
        $ifNull: [
          { $arrayElemAt: ["$classInfo.class_name", 0] },
          "$academic.class", // Keep existing if no lookup result
          null,
        ],
      },
    },
  },
  // Clean up temporary fields
  {
    $project: {
      departmentInfo: 0,
      classInfo: 0,
      deptObjectId: 0,
      classObjectId: 0,
    },
  },
];

module.exports = studentEnrichmentStages;
