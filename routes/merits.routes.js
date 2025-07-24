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

  router.get("/top-merit-students", async (req, res) => {
    try {
      const { search } = req.query;

      let matchStage;

      if (search) {
        // Only search by name/email (no merit filter)
        matchStage = {
          $or: [
            { "student.name": { $regex: search, $options: "i" } },
            { "student.family_name": { $regex: search, $options: "i" } },
            { "student.email": { $regex: search, $options: "i" } },
          ],
        };
      } else {
        // Only show students with 50+ merit
        matchStage = {
          totalMerit: { $gte: 50 },
        };
      }

      const result = await meritsCollection
        .aggregate([
          { $addFields: { studentObjectId: { $toObjectId: "$student_id" } } },
          {
            $group: {
              _id: "$studentObjectId",
              totalMerit: { $sum: "$merit_points" },
            },
          },
          {
            $lookup: {
              from: "students",
              localField: "_id",
              foreignField: "_id",
              as: "student",
            },
          },
          { $unwind: "$student" },
          { $match: matchStage },
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
      console.error("Aggregation error:", error);
      res.status(500).send({ message: "Server Error" });
    }
  });

  // router.get("/top-merit-students", async (req, res) => {
  //   try {
  //     const result = await meritsCollection
  //       .aggregate([
  //         // Convert to ObjectId
  //         {
  //           $addFields: {
  //             studentObjectId: { $toObjectId: "$student_id" },
  //           },
  //         },

  //         // Group by student_id
  //         {
  //           $group: {
  //             _id: "$studentObjectId",
  //             totalMerit: { $sum: "$merit_points" },
  //           },
  //         },

  //         // Filter students with merit >= 50
  //         {
  //           $match: {
  //             totalMerit: { $gte: 50 },
  //           },
  //         },

  //         // Lookup student info
  //         {
  //           $lookup: {
  //             from: "students",
  //             localField: "_id",
  //             foreignField: "_id",
  //             as: "student",
  //           },
  //         },
  //         { $unwind: "$student" },

  //         // Lookup department
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

  //         // Lookup class
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

  //         // Final projection
  //         {
  //           $project: {
  //             student_id: "$_id",
  //             totalMerit: 1,
  //             student_name: "$student.name",
  //             family_name: "$student.family_name",
  //             department: {
  //               $ifNull: ["$department.dept_name", "Unknown Department"],
  //             },
  //             class: {
  //               $ifNull: ["$class.class_name", "Unknown Class"],
  //             },
  //           },
  //         },
  //       ])
  //       .toArray();

  //     res.send(result);
  //   } catch (error) {
  //     res.status(500).send({ message: "Server Error" });
  //   }
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
      res.status(500).send({ message: "Server error" });
    }
  });

  return router;
};
