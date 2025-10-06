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

  // Get merit data for single student
  // Get merit data for single student with filters
  router.get("/student/:studentId", async (req, res) => {
    try {
      const { studentId } = req.params;
      const { month, year } = req.query; // Get month and year from query params

      if (!studentId) {
        return res.status(400).send({ message: "Student ID is required" });
      }

      // Build base filter
      const baseFilter = {
        student_id: studentId,
      };

      // Add date filters if provided - using string matching for ISO date strings
      let dateFilter = {};

      if (month && year) {
        // Filter by specific month and year using regex on date string
        const monthStr = month.toString().padStart(2, "0");
        dateFilter.date = {
          $regex: `^${year}-${monthStr}`, // Matches "2025-08-*"
        };
      } else if (year) {
        // Filter by entire year using regex
        dateFilter.date = {
          $regex: `^${year}-`, // Matches "2025-*"
        };
      }

      // Combine filters
      const filter = { ...baseFilter, ...dateFilter };

      // Get all merit records for the student with filters
      const meritRecords = await meritsCollection
        .find(filter)
        .sort({ date: 1 }) // Sort by date ascending for trends
        .toArray();

      // Calculate total merit points
      const totalMerit = meritRecords.reduce(
        (sum, record) => sum + (record.merit_points || 0),
        0
      );

      // Calculate monthly merit points (last 30 days) - only if no specific month filter
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const recentMerit =
        !month && !year
          ? meritRecords
              .filter((record) => new Date(record.date) >= thirtyDaysAgo)
              .reduce((sum, record) => sum + (record.merit_points || 0), 0)
          : totalMerit; // If filtered, recent merit is the same as total

      // Group by behavior type with POINT SUMS
      const behaviorBreakdown = meritRecords.reduce((acc, record) => {
        const behavior = record.behavior || "Other";
        if (!acc[behavior]) {
          acc[behavior] = {
            count: 0,
            totalPoints: 0,
            averagePoints: 0,
          };
        }
        acc[behavior].count += 1;
        acc[behavior].totalPoints += record.merit_points || 0;
        acc[behavior].averagePoints =
          acc[behavior].totalPoints / acc[behavior].count;
        return acc;
      }, {});

      // Monthly trend calculation - adapt based on filters
      const monthlyTrend = {};
      let allMonths = [];

      if (month && year) {
        // If specific month selected, show daily trend for that month
        const daysInMonth = new Date(year, month, 0).getDate();
        for (let day = 1; day <= daysInMonth; day++) {
          const dayStr = day.toString().padStart(2, "0");
          const dayKey = `${dayStr} ${getMonthName(month).substring(0, 3)}`;
          allMonths.push(dayKey);
          monthlyTrend[dayKey] = 0;
        }
      } else if (year) {
        // If year selected, show monthly trend for that year
        for (let m = 1; m <= 12; m++) {
          const monthKey = getMonthName(m).substring(0, 3);
          allMonths.push(monthKey);
          monthlyTrend[monthKey] = 0;
        }
      } else {
        // Default: show last 6 months
        const today = new Date();
        for (let i = 5; i >= 0; i--) {
          const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
          const monthKey = date.toLocaleString("default", {
            month: "short",
            year: "numeric",
          });
          allMonths.push(monthKey);
          monthlyTrend[monthKey] = 0;
        }
      }

      // Fill in actual data for monthly/daily trend
      meritRecords.forEach((record) => {
        const recordDate = new Date(record.date);
        let trendKey;

        if (month && year) {
          // Daily trend for specific month
          const day = recordDate.getDate();
          const dayKey = `${day.toString().padStart(2, "0")} ${getMonthName(
            month
          ).substring(0, 3)}`;
          trendKey = dayKey;
        } else if (year) {
          // Monthly trend for specific year
          const monthKey = recordDate.toLocaleString("default", {
            month: "short",
          });
          trendKey = monthKey;
        } else {
          // Default monthly trend
          const monthKey = recordDate.toLocaleString("default", {
            month: "short",
            year: "numeric",
          });
          trendKey = monthKey;
        }

        if (monthlyTrend.hasOwnProperty(trendKey)) {
          monthlyTrend[trendKey] += record.merit_points || 0;
        }
      });

      // Calculate weekly trend (only if no specific filters)
      const weeklyTrend = {};
      const allWeeks = [];

      if (!month && !year) {
        for (let i = 7; i >= 0; i--) {
          const date = new Date();
          date.setDate(date.getDate() - i * 7);
          const weekKey = `Week ${i + 1}`;
          allWeeks.push(weekKey);
          weeklyTrend[weekKey] = 0;
        }

        meritRecords.forEach((record) => {
          const recordDate = new Date(record.date);
          const weekAgo = new Date();
          weekAgo.setDate(weekAgo.getDate() - 56); // 8 weeks ago

          if (recordDate >= weekAgo) {
            const weekDiff = Math.floor(
              (new Date() - recordDate) / (7 * 24 * 60 * 60 * 1000)
            );
            const weekKey = `Week ${8 - weekDiff}`;
            if (weeklyTrend.hasOwnProperty(weekKey)) {
              weeklyTrend[weekKey] += record.merit_points || 0;
            }
          }
        });
      }

      // Calculate top behaviors by points
      const topBehaviors = Object.entries(behaviorBreakdown)
        .sort(([, a], [, b]) => b.totalPoints - a.totalPoints)
        .slice(0, 5);
      // Determine how many merits to show (6 in both cases)
      let lastMerits;

      if (month && year) {
        // Filter only records from that specific month/year
        const monthStr = month.toString().padStart(2, "0");
        const filteredMonthRecords = meritRecords.filter((record) =>
          record.date.startsWith(`${year}-${monthStr}`)
        );

        lastMerits = filteredMonthRecords.slice(-6).reverse(); // last 6 of that month
      } else {
        // For all time or only year → last 6 overall
        lastMerits = meritRecords.slice(-6).reverse();
      }

      const result = {
        totalMerit,
        recentMerit,
        totalRecords: meritRecords.length,
        meritRecords: lastMerits, // Last 10 records, most recent first
        behaviorBreakdown,
        trendType: month && year ? "daily" : year ? "monthly" : "monthly",
        trendData: allMonths.map((period) => ({
          period,
          points: monthlyTrend[period],
        })),
        weeklyTrend:
          !month && !year
            ? allWeeks.map((week) => ({
                week,
                points: weeklyTrend[week],
              }))
            : [],
        averagePoints:
          meritRecords.length > 0 ? totalMerit / meritRecords.length : 0,
        topBehaviors,
        behaviorStats: {
          mostFrequent:
            Object.entries(behaviorBreakdown).sort(
              ([, a], [, b]) => b.count - a.count
            )[0]?.[0] || "None",
          highestValue:
            Object.entries(behaviorBreakdown).sort(
              ([, a], [, b]) => b.averagePoints - a.averagePoints
            )[0]?.[0] || "None",
          totalBehaviors: Object.keys(behaviorBreakdown).length,
        },
        timeline: meritRecords.map((record) => ({
          date: record.date,
          points: record.merit_points,
          behavior: record.behavior,
        })),
        filters: {
          month: month || null,
          year: year || null,
          applied: !!(month || year),
        },
        periodInfo:
          month && year
            ? `Showing data for ${getMonthName(month)} ${year}`
            : year
            ? `Showing data for year ${year}`
            : "Showing all time data",
      };

      res.send(result);
    } catch (err) {
      console.error("Error fetching merit records:", err);
      res.status(500).send({
        message: "Error fetching merit records",
        error: err.message,
      });
    }
  });

  // Helper function to get month name
  function getMonthName(month) {
    const months = [
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
    return months[parseInt(month) - 1] || month;
  }

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
          "student.activity": "active", // ✅ Only active students when searching
        };
      } else {
        // Only show students with 50+ merit
        matchStage = {
          totalMerit: { $gte: 50 },
          "student.activity": "active", // ✅ Only active students for top list
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
