const express = require("express");
const { ObjectId } = require("mongodb");

const handleAttendanceAlerts = require("../config/handleAttendanceAlerts");
const router = express.Router();

module.exports = (
  attendancesCollection,
  notificationsLogCollection,
  studentsCollection
) => {
  router.get("/", async (req, res) => {
    const result = await attendancesCollection.find().toArray();
    res.send(result);
  });

  router.post("/", async (req, res) => {
    try {
      const newAttendance = req.body;
      const result = await attendancesCollection.insertOne(newAttendance);

      // Handle alerts for new attendance records
      await handleAttendanceAlerts(
        newAttendance,
        notificationsLogCollection,
        studentsCollection
      );

      res.send(result);
    } catch (error) {
      res.status(500).send({ message: "Error creating attendance record" });
    }
  });

  // router.post("/", async (req, res) => {
  //   const newAttendance = req.body;
  //   const result = await attendancesCollection.insertOne(newAttendance);
  //   res.send(result);
  // });

  // Get attendance for specific students and date range
  // In your attendance routes
  router.get("/filtered", async (req, res) => {
    try {
      const { studentIds, startDate, endDate, classId } = req.query; // Add classId

      if (!studentIds || !startDate || !endDate || !classId) {
        // Require classId
        return res.status(400).send({
          message: "studentIds, startDate, endDate, and classId are required",
        });
      }

      const studentIdsArray = studentIds.split(",");

      const attendance = await attendancesCollection
        .find({
          student_id: { $in: studentIdsArray },
          class_id: classId, // Add class filter
          date: {
            $gte: startDate,
            $lte: endDate,
          },
          attendance: "student",
        })
        .toArray();

      res.send(attendance);
    } catch (error) {
      console.error("Error fetching filtered attendance:", error);
      res.status(500).send({ message: "Error fetching attendance data" });
    }
  });

  // Present all students for a specific date and class
  // Present all students for a specific date and class
  router.post("/present-all", async (req, res) => {
    try {
      const { studentIds, classId, date } = req.body;

      if (!studentIds || !classId || !date) {
        return res.status(400).send({
          message: "studentIds, classId, and date are required",
        });
      }

      // Parse studentIds from array
      const studentIdsArray = Array.isArray(studentIds)
        ? studentIds
        : [studentIds];

      // Check which students already have attendance for this date and class
      const existingAttendances = await attendancesCollection
        .find({
          student_id: { $in: studentIdsArray },
          date: date,
          class_id: classId,
        })
        .toArray();

      const existingStudentIds = existingAttendances.map(
        (att) => att.student_id
      );

      // Filter out students who already have attendance for this date
      const newStudentIds = studentIdsArray.filter(
        (id) => !existingStudentIds.includes(id)
      );

      let insertedCount = 0;

      // Create new attendance records only for students without existing records
      if (newStudentIds.length > 0) {
        const newAttendances = newStudentIds.map((studentId) => ({
          class_id: classId,
          student_id: studentId,
          date: date,
          status: "present",
          attendance: "student",
        }));

        const result = await attendancesCollection.insertMany(newAttendances);
        insertedCount = result.insertedCount;
      }

      // Update existing records to "present" status
      let updatedCount = 0;
      if (existingStudentIds.length > 0) {
        const updateResult = await attendancesCollection.updateMany(
          {
            student_id: { $in: existingStudentIds },
            date: date,
            class_id: classId,
          },
          {
            $set: {
              status: "present",
            },
          }
        );
        updatedCount = updateResult.modifiedCount;
      }

      res.send({
        message: `Marked ${
          insertedCount + updatedCount
        } students as present (${insertedCount} new, ${updatedCount} updated)`,
        insertedCount: insertedCount,
        updatedCount: updatedCount,
        totalAffected: insertedCount + updatedCount,
      });
    } catch (error) {
      console.error("Error marking all students present:", error);
      res.status(500).send({ message: "Error marking students as present" });
    }
  });

  // Remove all attendance for a specific date and class
  router.delete("/remove-all", async (req, res) => {
    try {
      const { classId, date } = req.body;

      if (!classId || !date) {
        return res.status(400).send({
          message: "classId and date are required",
        });
      }

      const result = await attendancesCollection.deleteMany({
        class_id: classId,
        date: date,
        attendance: "student",
      });

      res.send({
        message: `Removed ${result.deletedCount} attendance records`,
        deletedCount: result.deletedCount,
      });
    } catch (error) {
      console.error("Error removing all attendance:", error);
      res.status(500).send({ message: "Error removing attendance records" });
    }
  });

  router.get("/teacher/:teacherId/date/:date", async (req, res) => {
    try {
      const { teacherId, date } = req.params;

      const result = await attendancesCollection.findOne({
        staff_id: teacherId, // ✅ string instead of ObjectId
        date: date,
      });
      res.send(result || null);
    } catch (err) {
      res.status(500).send({ message: "Error fetching attendance record" });
    }
  });
  // Get aggregated attendance statistics for single student
  router.get("/student/:studentId/summary", async (req, res) => {
    try {
      const { studentId } = req.params;
      const { month, year } = req.query; // Get month and year from query params

      if (!studentId) {
        return res.status(400).send({ message: "Student ID is required" });
      }

      // Check if student exists
      const student = await studentsCollection.findOne({
        _id: new ObjectId(studentId),
      });

      if (!student) {
        return res.status(404).send({ message: "Student not found" });
      }

      // Build match filter
      const matchFilter = {
        student_id: studentId,
      };

      // Add month and year filters if provided
      if (month && year) {
        // Since date is stored as string "YYYY-MM-DD", use regex to filter
        const monthStr = month.toString().padStart(2, "0");
        matchFilter.date = {
          $regex: `^${year}-${monthStr}-`, // Matches "2024-10-*"
        };
      } else if (year) {
        // Filter by year only
        matchFilter.date = {
          $regex: `^${year}-`, // Matches "2024-*"
        };
      } else if (month) {
        // If only month is provided, use current year
        const currentYear = new Date().getFullYear();
        const monthStr = month.toString().padStart(2, "0");
        matchFilter.date = {
          $regex: `^${currentYear}-${monthStr}-`, // Matches "2024-10-*"
        };
      }

      const aggregation = await attendancesCollection
        .aggregate([
          {
            $match: matchFilter,
          },
          {
            $group: {
              _id: "$status",
              count: { $sum: 1 },
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: "$count" },
              statusCounts: {
                $push: {
                  k: "$_id",
                  v: "$count",
                },
              },
            },
          },
          {
            $project: {
              _id: 0,
              total: 1,
              statusCounts: {
                $arrayToObject: "$statusCounts",
              },
            },
          },
          {
            $project: {
              total: 1,
              present: { $ifNull: ["$statusCounts.present", 0] },
              absent: { $ifNull: ["$statusCounts.absent", 0] },
              late: { $ifNull: ["$statusCounts.late", 0] },
              half_day: { $ifNull: ["$statusCounts.half_day", 0] },
            },
          },
        ])
        .toArray();

      // If no attendance records found, return default structure
      if (aggregation.length === 0) {
        const defaultResult = {
          total: 0,
          present: 0,
          absent: 0,
          late: 0,
          half_day: 0,
          studentName: student.name,
          studentId: studentId,
          filters: {
            month: month || null,
            year: year || null,
          },
          message:
            month || year
              ? `No attendance records found for ${
                  month ? getMonthName(month) : ""
                }${month && year ? " " : ""}${year || ""}`.trim()
              : "No attendance records found",
        };
        return res.send(defaultResult);
      }

      // Format the response with student info and filters
      const result = {
        ...aggregation[0],
        studentName: student.name,
        studentId: studentId,
        filters: {
          month: month || null,
          year: year || null,
        },
      };

      res.send(result);
    } catch (err) {
      console.error("Error fetching attendance summary:", err);
      res.status(500).send({
        message: "Error fetching attendance summary",
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
  router.patch("/:id", async (req, res) => {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid attendance ID format" });
    }

    const query = { _id: new ObjectId(id) };
    const { status } = req.body;

    try {
      // Step 1: Update status
      const result = await attendancesCollection.updateOne(query, {
        $set: { status },
      });

      if (result.modifiedCount === 0) {
        return res
          .status(404)
          .send({ message: "Attendance not found or status unchanged" });
      }

      // Step 2: Get updated document
      const updatedAttendance = await attendancesCollection.findOne(query);

      if (!updatedAttendance?.student_id) {
        return res.status(400).send({ message: "Missing student_id" });
      }

      // Step 3: Run alerts logic
      await handleAttendanceAlerts(
        updatedAttendance,
        notificationsLogCollection,
        studentsCollection
      );

      // Step 4: Return updated data
      res.send(updatedAttendance);
    } catch (error) {
      res
        .status(500)
        .send({ message: "Error updating attendance record", error });
    }
  });

  // router.patch("/:id", async (req, res) => {
  //   const id = req.params.id;
  //   if (!ObjectId.isValid(id)) {
  //     return res.status(400).send({ message: "Invalid teacher ID format" });
  //   }
  //   const query = { _id: new ObjectId(id) };
  //   const { status } = req.body;
  //   const updatedDoc = {
  //     $set: { status },
  //   };
  //   const result = await attendancesCollection.updateOne(query, updatedDoc);
  //   res.send(result);
  // });

  // PATCH time‑out + total_hours
  router.patch("/:id/timeout", async (req, res) => {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid attendance ID format" });
    }

    const query = { _id: new ObjectId(id) };
    const attendance = await attendancesCollection.findOne(query);

    if (!attendance) {
      return res.status(404).send({ message: "Attendance record not found" });
    }

    if (!attendance.time_in) {
      return res.status(400).send({ message: "time_in missing" });
    }

    const now = new Date();
    const time_out = now.toTimeString().split(" ")[0];

    // Parse the time_in (format: "HH:MM:SS")
    const [hoursIn, minutesIn, secondsIn] = attendance.time_in
      .split(":")
      .map(Number);
    const timeInDate = new Date();
    timeInDate.setHours(hoursIn, minutesIn, secondsIn, 0);

    // Calculate difference in milliseconds
    const diffMs = now - timeInDate;

    // Convert to hours, minutes, seconds
    const totalSeconds = Math.floor(diffMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const total_hours = `${hours} : ${minutes} : ${seconds}`;

    const result = await attendancesCollection.updateOne(query, {
      $set: { time_out, total_hours },
    });

    res.send(result);
  });
  router.delete("/:id", async (req, res) => {
    const attendanceId = req.params.id;
    if (!ObjectId.isValid(attendanceId)) {
      return res.status(400).send({ message: "Invalid attendance ID format" });
    }
    const query = { _id: new ObjectId(attendanceId) };

    const result = await attendancesCollection.deleteOne(query);
    res.send(result);
  });

  router.get("/present-today/:type", async (req, res) => {
    try {
      const { type } = req.params;

      // Only allow 'student' or 'staff'
      if (type !== "student" && type !== "staff") {
        return res
          .status(400)
          .send({ message: "Invalid type. Must be 'student' or 'staff'." });
      }

      const today = new Date().toISOString().split("T")[0];

      const presentCount = await attendancesCollection.countDocuments({
        attendance: type,
        status: "present",
        date: today,
      });

      res.send({
        date: today,
        type,
        present_count: presentCount,
      });
    } catch (error) {
      console.error("Error fetching today's present count:", error);
      res.status(500).send({ message: "Internal Server Error" });
    }
  });

  return router;
};
