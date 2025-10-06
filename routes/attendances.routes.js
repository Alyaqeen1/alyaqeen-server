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
