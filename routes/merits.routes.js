const express = require("express");
const { ObjectId } = require("mongodb");
const router = express.Router();

module.exports = (
  meritsCollection,
  notificationsCollection,
  studentsCollection
) => {
  router.get("/", async (req, res) => {
    const result = await meritsCollection.find().toArray();
    res.send(result);
  });

  // router.get("/with-details", async (req, res) => {
  //   try {
  //     const result = await meritsCollection
  //       .aggregate([
  //         // Initial conversion
  //         {
  //           $addFields: {
  //             studentObjectId: { $toObjectId: "$student_id" },
  //             teacherObjectId: { $toObjectId: "$teacher_id" },
  //           },
  //         },

  //         // Student lookup
  //         {
  //           $lookup: {
  //             from: "students",
  //             localField: "studentObjectId",
  //             foreignField: "_id",
  //             as: "student",
  //           },
  //         },
  //         { $unwind: "$student" },

  //         // Debug stage 1 - check what we're working with
  //         {
  //           $addFields: {
  //             debugBeforeLookup: {
  //               dept_id: "$student.academic.dept_id",
  //               dept_id_type: { $type: "$student.academic.dept_id" },
  //               class_id: "$student.academic.class_id",
  //               class_id_type: { $type: "$student.academic.class_id" },
  //             },
  //           },
  //         },

  //         // Department lookup with conversion
  //         {
  //           $lookup: {
  //             from: "departments",
  //             let: { deptId: "$student.academic.dept_id" },
  //             pipeline: [
  //               {
  //                 $match: {
  //                   $expr: {
  //                     $eq: [
  //                       "$_id",
  //                       {
  //                         $cond: [
  //                           { $eq: [{ $type: "$$deptId" }, "string"] },
  //                           { $toObjectId: "$$deptId" },
  //                           "$$deptId",
  //                         ],
  //                       },
  //                     ],
  //                   },
  //                 },
  //               },
  //             ],
  //             as: "department",
  //           },
  //         },
  //         {
  //           $unwind: { path: "$department", preserveNullAndEmptyArrays: true },
  //         },

  //         // Class lookup with conversion
  //         {
  //           $lookup: {
  //             from: "classes",
  //             let: { classId: "$student.academic.class_id" },
  //             pipeline: [
  //               {
  //                 $match: {
  //                   $expr: {
  //                     $eq: [
  //                       "$_id",
  //                       {
  //                         $cond: [
  //                           { $eq: [{ $type: "$$classId" }, "string"] },
  //                           { $toObjectId: "$$classId" },
  //                           "$$classId",
  //                         ],
  //                       },
  //                     ],
  //                   },
  //                 },
  //               },
  //             ],
  //             as: "class",
  //           },
  //         },
  //         { $unwind: { path: "$class", preserveNullAndEmptyArrays: true } },

  //         // Teacher lookup
  //         {
  //           $lookup: {
  //             from: "teachers",
  //             localField: "teacherObjectId",
  //             foreignField: "_id",
  //             as: "teacher",
  //           },
  //         },
  //         { $unwind: { path: "$teacher", preserveNullAndEmptyArrays: true } },

  //         // Debug stage 2 - check lookup results
  //         {
  //           $addFields: {
  //             debugAfterLookup: {
  //               departmentFound: { $ifNull: ["$department", "NOT FOUND"] },
  //               classFound: { $ifNull: ["$class", "NOT FOUND"] },
  //             },
  //           },
  //         },

  //         // Final projection
  //         {
  //           $project: {
  //             _id: 1,
  //             student_id: 1,
  //             teacher_id: 1,
  //             behavior: 1,
  //             incident: 1,
  //             merit_points: 1,
  //             date: 1,
  //             student_name: "$student.name",
  //             family_name: "$student.family_name",
  //             department: {
  //               $ifNull: ["$department.dept_name", "Unknown Department"],
  //             },
  //             class: {
  //               $ifNull: ["$class.class_name", "Unknown Class"],
  //             },
  //             teacher_name: {
  //               $ifNull: ["$teacher.name", "Unknown Teacher"],
  //             },
  //           },
  //         },
  //       ])
  //       .toArray();

  //     res.send(result);
  //   } catch (error) {
  //     console.error("Merits aggregation error:", error);
  //     res.status(500).send({ message: "Server Error" });
  //   }
  // });

  router.get("/top-merit-students", async (req, res) => {
    try {
      const result = await meritsCollection
        .aggregate([
          // Convert to ObjectId
          {
            $addFields: {
              studentObjectId: { $toObjectId: "$student_id" },
            },
          },

          // Group by student_id
          {
            $group: {
              _id: "$studentObjectId",
              totalMerit: { $sum: "$merit_points" },
            },
          },

          // Filter students with merit >= 50
          {
            $match: {
              totalMerit: { $gte: 50 },
            },
          },

          // Lookup student info
          {
            $lookup: {
              from: "students",
              localField: "_id",
              foreignField: "_id",
              as: "student",
            },
          },
          { $unwind: "$student" },

          // Lookup department
          {
            $lookup: {
              from: "departments",
              let: { deptId: "$student.academic.dept_id" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: [
                        "$_id",
                        {
                          $cond: [
                            { $eq: [{ $type: "$$deptId" }, "string"] },
                            { $toObjectId: "$$deptId" },
                            "$$deptId",
                          ],
                        },
                      ],
                    },
                  },
                },
              ],
              as: "department",
            },
          },
          {
            $unwind: { path: "$department", preserveNullAndEmptyArrays: true },
          },

          // Lookup class
          {
            $lookup: {
              from: "classes",
              let: { classId: "$student.academic.class_id" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: [
                        "$_id",
                        {
                          $cond: [
                            { $eq: [{ $type: "$$classId" }, "string"] },
                            { $toObjectId: "$$classId" },
                            "$$classId",
                          ],
                        },
                      ],
                    },
                  },
                },
              ],
              as: "class",
            },
          },
          { $unwind: { path: "$class", preserveNullAndEmptyArrays: true } },

          // Final projection
          {
            $project: {
              student_id: "$_id",
              totalMerit: 1,
              student_name: "$student.name",
              family_name: "$student.family_name",
              department: {
                $ifNull: ["$department.dept_name", "Unknown Department"],
              },
              class: {
                $ifNull: ["$class.class_name", "Unknown Class"],
              },
            },
          },
        ])
        .toArray();

      res.send(result);
    } catch (error) {
      console.error("Top Merit Students Error:", error);
      res.status(500).send({ message: "Server Error" });
    }
  });

  // router.post("/", async (req, res) => {
  //   const newMerit = req.body;
  //   const result = await meritsCollection.insertOne(newMerit);
  //   res.send(result);
  // });

  router.post("/", async (req, res) => {
    const newMerit = req.body;
    try {
      // Insert the new merit point entry
      const result = await meritsCollection.insertOne(newMerit);

      const studentId = newMerit.student_id;

      // Calculate total merit points for this student
      const studentMerit = await meritsCollection
        .aggregate([
          {
            $match: { student_id: studentId },
          },
          {
            $group: {
              _id: "$student_id",
              totalMerit: { $sum: "$merit_points" },
            },
          },
        ])
        .toArray();

      const totalMerit = studentMerit[0]?.totalMerit || 0;

      // If merit >= 50, check if a notification exists
      if (totalMerit >= 50) {
        const existingNotification = await notificationsCollection.findOne({
          type: "merit",
          student_id: studentId,
        });

        if (!existingNotification) {
          // Optional: Fetch student name
          const student = await studentsCollection.findOne({
            _id: new ObjectId(studentId),
          });
          const studentName = student?.name || "A student";

          // Insert new notification
          await notificationsCollection.insertOne({
            type: "merit",
            student_id: studentId,
            message: `${studentName} has earned 50 merit points!`,
            isRead: false,
            createdAt: new Date(),
            link: "/dashboard/merit-students",
          });
        }
      }

      res.send(result);
    } catch (error) {
      console.error("Error adding merit and checking notification:", error);
      res.status(500).send({ message: "Server error" });
    }
  });

  return router;
};
