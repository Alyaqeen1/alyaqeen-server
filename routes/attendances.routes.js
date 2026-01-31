const express = require("express");
const { ObjectId } = require("mongodb");

const handleAttendanceAlerts = require("../config/handleAttendanceAlerts");
const router = express.Router();

module.exports = (
  attendancesCollection,
  notificationsLogCollection,
  studentsCollection,
  teachersCollection,
  classesCollection,
  feesCollection,
) => {
  router.get("/", async (req, res) => {
    const result = await attendancesCollection.find().toArray();
    res.send(result);
  });
  // In your attendance routes
  router.get("/student/:studentId", async (req, res) => {
    try {
      const { studentId } = req.params;

      const result = await attendancesCollection
        .find({ student_id: studentId })
        .sort({ date: -1 })
        .project({
          student_id: 1,
          class_id: 1, // optional
          date: 1,
          status: 1,
          attendance: 1,
          createdAt: 1,
        })
        .toArray();

      res.status(200).json(result);
    } catch (err) {
      console.error("Attendance route error:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  router.post("/", async (req, res) => {
    try {
      const newAttendance = req.body;
      const result = await attendancesCollection.insertOne(newAttendance);

      // Handle alerts for new attendance records
      await handleAttendanceAlerts(
        newAttendance,
        notificationsLogCollection,
        studentsCollection,
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
        (att) => att.student_id,
      );

      // Filter out students who already have attendance for this date
      const newStudentIds = studentIdsArray.filter(
        (id) => !existingStudentIds.includes(id),
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
          },
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
        studentsCollection,
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
  // Add this new route to your attendance routes file

  // Get attendance dashboard summary for today
  // Helper function to get UK date in YYYY-MM-DD format
  function getUKDate() {
    // Get current time in UTC
    const now = new Date();

    // UK is UTC+0 in winter, UTC+1 in summer (BST)
    // Using Europe/London timezone
    const ukDateString = now.toLocaleString("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    // Convert "DD/MM/YYYY" to "YYYY-MM-DD"
    const [day, month, year] = ukDateString.split("/");
    return `${year}-${month}-${day}`;
  }

  router.get("/dashboard-summary-today", async (req, res) => {
    try {
      // Automatically get today's UK date
      const today = getUKDate();

      // Get day of week (0=Sunday, 1=Monday, ..., 6=Saturday)
      const dayOfWeek = new Date(today).getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6; // Sunday=0, Saturday=6
      const sessionType = isWeekend ? "weekend" : "weekdays";

      // Get all classes based on today's session type
      const todaysClasses = await classesCollection
        .find({
          session: sessionType,
        })
        .toArray();

      const todaysClassIds = todaysClasses.map((cls) => cls._id.toString());

      // If no classes today, return early
      if (todaysClassIds.length === 0) {
        return res.send({
          date: today,
          sessionType: sessionType,
          message: `No ${sessionType} classes scheduled for today.`,
          teachers_with_attendance: [],
          teachers_without_attendance: [],
          classes_without_attendance: [],
          absent_students: [],
        });
      }

      // Get teachers who have classes assigned for today's session type
      const teachers = await teachersCollection
        .find({
          status: "approved",
          activity: "active",
          class_ids: { $in: todaysClassIds },
        })
        .project({
          _id: 1,
          name: 1,
          class_ids: 1,
        })
        .toArray();

      // Get attendance for today
      const todaysAttendance = await attendancesCollection
        .find({
          date: today,
        })
        .toArray();

      // Track which classes have any student attendance
      const classesWithAttendance = new Set();
      const studentAttendanceMap = new Map(); // For checking absent students

      todaysAttendance.forEach((record) => {
        if (record.attendance === "student") {
          classesWithAttendance.add(record.class_id);
          const key = `${record.student_id}_${record.class_id}`;
          studentAttendanceMap.set(key, record);
        }
      });

      // Create class name map
      const classNameMap = new Map(
        todaysClasses.map((cls) => [cls._id.toString(), cls.class_name]),
      );

      // Find classes without ANY attendance
      const classesWithoutAttendance = [];
      for (const classId of todaysClassIds) {
        if (!classesWithAttendance.has(classId)) {
          const className = classNameMap.get(classId) || "Unknown Class";

          // Find teachers for this class
          const teachersForThisClass = teachers
            .filter((teacher) =>
              teacher.class_ids?.some((id) => id.toString() === classId),
            )
            .map((teacher) => ({
              teacher_id: teacher._id,
              teacher_name: teacher.name,
            }));

          classesWithoutAttendance.push({
            class_id: classId,
            class_name: className,
            teachers: teachersForThisClass,
            message: "No attendance taken for this class",
          });
        }
      }

      // Process teachers - who has given attendance and who hasn't
      const teachersWithAttendance = [];
      const teachersWithoutAttendance = [];

      for (const teacher of teachers) {
        const teacherClasses =
          teacher.class_ids?.filter((id) =>
            todaysClassIds.includes(id.toString()),
          ) || [];

        if (teacherClasses.length === 0) continue;

        // Check which classes this teacher has taken attendance for
        const attendedClasses = [];
        const notAttendedClasses = [];

        for (const classId of teacherClasses) {
          const classIdStr = classId.toString();
          const className = classNameMap.get(classIdStr) || "Unknown Class";

          const classAttendanceInfo = {
            class_id: classId,
            class_name: className,
            attendance_taken: classesWithAttendance.has(classIdStr),
          };

          if (classesWithAttendance.has(classIdStr)) {
            attendedClasses.push(classAttendanceInfo);
          } else {
            notAttendedClasses.push(classAttendanceInfo);
          }
        }

        const teacherData = {
          teacher_id: teacher._id,
          teacher_name: teacher.name,
          attended_classes: attendedClasses,
          not_attended_classes: notAttendedClasses,
          has_attendance_for_all_classes: notAttendedClasses.length === 0,
        };

        // Teacher is "with attendance" if they have ANY attended classes
        if (attendedClasses.length > 0) {
          teachersWithAttendance.push(teacherData);
        } else {
          teachersWithoutAttendance.push(teacherData);
        }
      }

      // Get absent students (only from classes where attendance was taken AND status is "absent")
      const absentStudents = [];

      // Only check classes that have attendance taken
      for (const classId of Array.from(classesWithAttendance)) {
        const className = classNameMap.get(classId) || "Unknown Class";

        // Get all students in this class
        const studentsInClass = await studentsCollection
          .find({
            activity: "active",
            status: "enrolled",
            "academic.enrollments": {
              $elemMatch: {
                class_id: classId,
              },
            },
          })
          .project({
            _id: 1,
            name: 1,
          })
          .toArray();

        // Check each student's attendance
        for (const student of studentsInClass) {
          const attendanceKey = `${student._id.toString()}_${classId}`;
          const attendanceRecord = studentAttendanceMap.get(attendanceKey);

          // Only include if attendance record exists AND status is "absent"
          if (attendanceRecord && attendanceRecord.status === "absent") {
            absentStudents.push({
              student_name: student.name,
              class_name: className,
              status: "absent", // Explicitly set to "absent"
            });
          }
          // Remove the "no_record" case entirely
        }
      }

      // Get present count for summary
      const totalClassesWithAttendance = classesWithAttendance.size;
      const totalTeachersCount =
        teachersWithAttendance.length + teachersWithoutAttendance.length;

      // Get current UK time for reference
      const now = new Date();
      const ukTime = now.toLocaleString("en-GB", {
        timeZone: "Europe/London",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });

      res.send({
        date: today,
        uk_time: ukTime,
        sessionType: sessionType,
        summary: {
          total_teachers: totalTeachersCount,
          teachers_with_attendance: teachersWithAttendance.length,
          teachers_without_attendance: teachersWithoutAttendance.length,
          total_classes_today: todaysClassIds.length,
          classes_with_attendance_taken: totalClassesWithAttendance,
          classes_without_attendance_taken: classesWithoutAttendance.length,
          total_absent_students: absentStudents.length,
        },
        teachers_with_attendance: teachersWithAttendance,
        teachers_without_attendance: teachersWithoutAttendance,
        classes_without_attendance: classesWithoutAttendance,
        absent_students: absentStudents.slice(0, 50), // First 50 absent students
        note:
          absentStudents.length > 50
            ? `Showing first 50 of ${absentStudents.length} absent students.`
            : `Found ${absentStudents.length} absent students.`,
      });
    } catch (error) {
      console.error("Error fetching today's dashboard summary:", error);
      res.status(500).send({
        message: "Error fetching today's dashboard summary",
        error: error.message,
      });
    }
  });

  // GET /api/attendance/dashboard-stats
  // GET /api/attendance/dashboard-stats
  router.get("/dashboard-stats", async (req, res) => {
    try {
      const today = getUKDate();
      const currentDate = new Date(today);
      const currentYear = currentDate.getFullYear();
      const currentMonth = currentDate.getMonth() + 1;

      // 1. TOTAL ACTIVE STUDENTS
      const totalActiveStudents = await studentsCollection.countDocuments({
        status: "enrolled",
        activity: "active",
      });

      // 2. CURRENT MONTH REVENUE - PAYMENTS ARRAY ONLY
      const monthPattern = `^${currentYear}-${String(currentMonth).padStart(2, "0")}`;

      const currentMonthRevenue = await feesCollection
        .aggregate([
          {
            $match: {
              status: "paid", // ONLY fully paid fees
              paymentType: { $in: ["monthly", "admission"] },
            },
          },
          {
            $addFields: {
              currentMonthPayments: {
                $filter: {
                  input: "$payments",
                  as: "payment",
                  cond: {
                    $regexMatch: {
                      input: "$$payment.date",
                      regex: monthPattern,
                    },
                  },
                },
              },
            },
          },
          {
            $match: {
              currentMonthPayments: { $ne: [] }, // Has payments in current month
            },
          },
          {
            $addFields: {
              currentMonthTotal: {
                $sum: "$currentMonthPayments.amount",
              },
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: "$currentMonthTotal" },
            },
          },
        ])
        .toArray();

      const revenueAmount = currentMonthRevenue[0]?.total || 0;

      // 3. THIS WEEK'S ATTENDANCE RATE (Mon-Sun week)
      const weekDates = getCurrentWeekDates(today);

      // Get attendance for this week
      const weekAttendance = await attendancesCollection
        .aggregate([
          {
            $match: {
              date: { $in: weekDates },
              attendance: "student",
            },
          },
          {
            $group: {
              _id: "$status",
              count: { $sum: 1 },
            },
          },
        ])
        .toArray();

      const totalPresentThisWeek =
        weekAttendance.find((a) => a._id === "present")?.count || 0;
      const totalAbsentThisWeek =
        weekAttendance.find((a) => a._id === "absent")?.count || 0;
      const totalWeekAttendance = totalPresentThisWeek + totalAbsentThisWeek;
      const attendanceRateThisWeek =
        totalWeekAttendance > 0
          ? ((totalPresentThisWeek / totalWeekAttendance) * 100).toFixed(1)
          : 0;

      // Get last week's attendance for comparison
      const lastWeekDates = getLastWeekDates(today);

      const lastWeekAttendance = await attendancesCollection
        .aggregate([
          {
            $match: {
              date: { $in: lastWeekDates },
              attendance: "student",
            },
          },
          {
            $group: {
              _id: "$status",
              count: { $sum: 1 },
            },
          },
        ])
        .toArray();

      const totalPresentLastWeek =
        lastWeekAttendance.find((a) => a._id === "present")?.count || 0;
      const totalLastWeek = lastWeekAttendance.reduce(
        (sum, item) => sum + item.count,
        0,
      );
      const attendanceRateLastWeek =
        totalLastWeek > 0
          ? ((totalPresentLastWeek / totalLastWeek) * 100).toFixed(1)
          : 0;

      // Calculate week-over-week change
      const weeklyChange =
        attendanceRateLastWeek > 0
          ? (
              ((parseFloat(attendanceRateThisWeek) -
                parseFloat(attendanceRateLastWeek)) /
                parseFloat(attendanceRateLastWeek)) *
              100
            ).toFixed(1)
          : parseFloat(attendanceRateThisWeek) > 0
            ? 100
            : 0;

      // 4. OUTSTANDING PAYMENTS
      const outstandingPayments = await feesCollection
        .aggregate([
          {
            $match: {
              status: { $in: ["partial", "pending"] },
              remaining: { $gt: 0 },
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: "$remaining" },
              count: { $sum: 1 },
            },
          },
        ])
        .toArray();

      const outstandingAmount = outstandingPayments[0]?.total || 0;
      const outstandingCount = outstandingPayments[0]?.count || 0;

      // Response
      res.send({
        success: true,
        date: today,
        stats: {
          // Card 1: Active Students
          totalActiveStudents: {
            value: totalActiveStudents,
            title: "Active Students",
            icon: "bi-people-fill",
            color: "#3b82f6", // blue
          },

          // Card 2: Monthly Revenue
          currentMonthRevenue: {
            value: `£${revenueAmount.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`,
            title: "Monthly Revenue",
            icon: "bi-wallet-fill",
            color: "#8b5cf6", // purple
          },

          // Card 3: This Week's Attendance Rate
          attendanceRate: {
            value: `${attendanceRateThisWeek}%`,
            change: parseFloat(weeklyChange),
            title: "Weekly Attendance",
            icon: "bi-calendar-check",
            color: "#10b981", // green
            details: {
              thisWeek: parseFloat(attendanceRateThisWeek),
              lastWeek: parseFloat(attendanceRateLastWeek),
              presentThisWeek: totalPresentThisWeek,
              totalThisWeek: totalWeekAttendance,
            },
          },

          // Card 4: Outstanding Payments
          outstandingPayments: {
            value: `£${outstandingAmount.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`,
            count: outstandingCount,
            title: "Outstanding Payments",
            icon: "bi-exclamation-circle",
            color: "#f59e0b", // amber
          },
        },
        metadata: {
          weekRange: `${weekDates[0]} to ${weekDates[weekDates.length - 1]}`,
          currentMonth: `${currentYear}-${String(currentMonth).padStart(2, "0")}`,
        },
      });
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).send({
        success: false,
        message: "Error fetching dashboard stats",
        error: error.message,
      });
    }
  });
  router.get("/attendance-stats", async (req, res) => {
    try {
      const { year, month, startDate, endDate } = req.query;

      // Determine date range based on parameters
      let dateFilter = {};
      let periodType = "";
      let periodLabel = "";

      if (startDate && endDate) {
        // Custom date range
        dateFilter = {
          date: { $gte: startDate, $lte: endDate },
        };
        periodType = "custom";
        periodLabel = `${startDate} to ${endDate}`;
      } else if (year && month) {
        // Specific month
        const monthStr = String(month).padStart(2, "0");
        dateFilter = {
          date: { $regex: `^${year}-${monthStr}` },
        };
        periodType = "month";
        periodLabel = `${year}-${monthStr}`;
      } else if (year) {
        // Whole year
        dateFilter = {
          date: { $regex: `^${year}` },
        };
        periodType = "year";
        periodLabel = `${year}`;
      } else {
        // Default: current month
        const today = getUKDate();
        const [currentYear, currentMonth] = today.split("-");
        dateFilter = {
          date: { $regex: `^${currentYear}-${currentMonth}` },
        };
        periodType = "current";
        periodLabel = `${currentYear}-${currentMonth}`;
      }

      // Get attendance for CURRENT period
      const attendanceStats = await attendancesCollection
        .aggregate([
          {
            $match: {
              ...dateFilter,
              attendance: "student",
            },
          },
          {
            $group: {
              _id: "$status",
              count: { $sum: 1 },
            },
          },
        ])
        .toArray();

      const totalPresent =
        attendanceStats.find((a) => a._id === "present")?.count || 0;
      const totalAbsent =
        attendanceStats.find((a) => a._id === "absent")?.count || 0;
      const totalLate =
        attendanceStats.find((a) => a._id === "late")?.count || 0;
      const totalHalfDay =
        attendanceStats.find((a) => a._id === "half_day")?.count || 0;

      const totalAttendance =
        totalPresent + totalAbsent + totalLate + totalHalfDay;
      const attendanceRate =
        totalAttendance > 0
          ? ((totalPresent / totalAttendance) * 100).toFixed(1)
          : 0;

      // Calculate PREVIOUS period for comparison
      let previousPeriodStats = { present: 0, absent: 0, total: 0, rate: 0 };

      if (periodType === "month") {
        // Get previous month
        const currentDate = new Date(`${year}-${month}-01`);
        currentDate.setMonth(currentDate.getMonth() - 1);
        const prevYear = currentDate.getFullYear();
        const prevMonth = String(currentDate.getMonth() + 1).padStart(2, "0");

        const prevDateFilter = {
          date: { $regex: `^${prevYear}-${prevMonth}` },
        };

        const prevStats = await attendancesCollection
          .aggregate([
            {
              $match: {
                ...prevDateFilter,
                attendance: "student",
              },
            },
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
              },
            },
          ])
          .toArray();

        const prevPresent =
          prevStats.find((a) => a._id === "present")?.count || 0;
        const prevAbsent =
          prevStats.find((a) => a._id === "absent")?.count || 0;
        const prevLate = prevStats.find((a) => a._id === "late")?.count || 0;
        const prevHalfDay =
          prevStats.find((a) => a._id === "half_day")?.count || 0;

        const prevTotal = prevPresent + prevAbsent + prevLate + prevHalfDay;
        const prevRate =
          prevTotal > 0 ? ((prevPresent / prevTotal) * 100).toFixed(1) : 0;

        previousPeriodStats = {
          present: prevPresent,
          absent: prevAbsent,
          total: prevTotal,
          rate: parseFloat(prevRate),
          period: `${prevYear}-${prevMonth}`,
        };
      } else if (periodType === "custom" && startDate && endDate) {
        // For custom range, calculate equivalent previous period
        const start = new Date(startDate);
        const end = new Date(endDate);
        const diffDays = Math.floor((end - start) / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end days

        // Calculate previous period of same duration
        const prevEnd = new Date(start);
        prevEnd.setDate(prevEnd.getDate() - 1); // Day before the start date

        const prevStart = new Date(prevEnd);
        prevStart.setDate(prevStart.getDate() - diffDays + 1); // Go back same number of days

        const prevStartStr = prevStart.toISOString().split("T")[0];
        const prevEndStr = prevEnd.toISOString().split("T")[0];
        const prevDateFilter = {
          date: { $gte: prevStartStr, $lte: prevEndStr },
        };

        const prevStats = await attendancesCollection
          .aggregate([
            {
              $match: {
                ...prevDateFilter,
                attendance: "student",
              },
            },
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
              },
            },
          ])
          .toArray();

        const prevPresent =
          prevStats.find((a) => a._id === "present")?.count || 0;
        const prevAbsent =
          prevStats.find((a) => a._id === "absent")?.count || 0;
        const prevLate = prevStats.find((a) => a._id === "late")?.count || 0;
        const prevHalfDay =
          prevStats.find((a) => a._id === "half_day")?.count || 0;

        const prevTotal = prevPresent + prevAbsent + prevLate + prevHalfDay;
        const prevRate =
          prevTotal > 0 ? ((prevPresent / prevTotal) * 100).toFixed(1) : 0;

        previousPeriodStats = {
          present: prevPresent,
          absent: prevAbsent,
          total: prevTotal,
          rate: parseFloat(prevRate),
          period: `${prevStartStr} to ${prevEndStr}`,
        };
      }

      // Calculate change percentage
      let changePercentage = 0;
      if (previousPeriodStats.rate > 0) {
        changePercentage = parseFloat(
          (
            ((parseFloat(attendanceRate) - previousPeriodStats.rate) /
              previousPeriodStats.rate) *
            100
          ).toFixed(1),
        );
      } else if (parseFloat(attendanceRate) > 0) {
        // If previous period had 0% but current has attendance
        changePercentage = 100;
      }

      res.json({
        success: true,
        period: periodLabel,
        periodType: periodType,
        stats: {
          present: totalPresent,
          absent: totalAbsent,
          late: totalLate,
          half_day: totalHalfDay,
          total: totalAttendance,
          rate: parseFloat(attendanceRate),
        },
        comparison: {
          previous: previousPeriodStats,
          change: changePercentage,
          isIncrease: changePercentage >= 0,
        },
      });
    } catch (error) {
      console.error("Error in attendance-stats route:", error);
      res.status(500).json({
        success: false,
        message: "Error fetching attendance statistics",
        error: error.message,
      });
    }
  });

  // router.get("/attendance-stats", async (req, res) => {
  //   try {
  //     const { year, month, startDate, endDate } = req.query;

  //     // Determine date range based on parameters
  //     let dateFilter = {};

  //     if (startDate && endDate) {
  //       // Custom date range
  //       dateFilter = {
  //         date: { $gte: startDate, $lte: endDate },
  //       };
  //     } else if (year && month) {
  //       // Specific month
  //       const monthStr = String(month).padStart(2, "0");
  //       dateFilter = {
  //         date: { $regex: `^${year}-${monthStr}` },
  //       };
  //     } else if (year) {
  //       // Whole year
  //       dateFilter = {
  //         date: { $regex: `^${year}` },
  //       };
  //     } else {
  //       // Default: current month
  //       const today = getUKDate();
  //       const [currentYear, currentMonth] = today.split("-");
  //       dateFilter = {
  //         date: { $regex: `^${currentYear}-${currentMonth}` },
  //       };
  //     }

  //     // Get attendance for the period
  //     const attendanceStats = await attendancesCollection
  //       .aggregate([
  //         {
  //           $match: {
  //             ...dateFilter,
  //             attendance: "student",
  //           },
  //         },
  //         {
  //           $group: {
  //             _id: "$status",
  //             count: { $sum: 1 },
  //           },
  //         },
  //       ])
  //       .toArray();

  //     const totalPresent =
  //       attendanceStats.find((a) => a._id === "present")?.count || 0;
  //     const totalAbsent =
  //       attendanceStats.find((a) => a._id === "absent")?.count || 0;
  //     const totalAttendance = totalPresent + totalAbsent;
  //     const attendanceRate =
  //       totalAttendance > 0
  //         ? ((totalPresent / totalAttendance) * 100).toFixed(1)
  //         : 0;

  //     res.json({
  //       success: true,
  //       period:
  //         startDate && endDate
  //           ? `${startDate} to ${endDate}`
  //           : year && month
  //             ? `${year}-${String(month).padStart(2, "0")}`
  //             : year || "Current period",
  //       stats: {
  //         present: totalPresent,
  //         absent: totalAbsent,
  //         total: totalAttendance,
  //         rate: parseFloat(attendanceRate),
  //       },
  //     });
  //   } catch (error) {
  //     // error handling
  //   }
  // });
  // Helper function to get current week dates (Monday to Sunday)
  function getCurrentWeekDates(today) {
    const dates = [];
    const currentDate = new Date(today);

    // Get Monday of this week
    const dayOfWeek = currentDate.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
    const monday = new Date(currentDate);
    monday.setDate(
      currentDate.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1),
    );

    // Generate all 7 days of the week
    for (let i = 0; i < 7; i++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      dates.push(date.toISOString().split("T")[0]);
    }

    return dates;
  }

  // Helper function to get last week dates
  function getLastWeekDates(today) {
    const dates = [];
    const currentDate = new Date(today);

    // Go back 7 days to get last week's Monday
    const lastWeekMonday = new Date(currentDate);
    lastWeekMonday.setDate(currentDate.getDate() - 7);

    // Get Monday of last week
    const dayOfWeek = lastWeekMonday.getDay();
    const monday = new Date(lastWeekMonday);
    monday.setDate(
      lastWeekMonday.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1),
    );

    // Generate all 7 days of last week
    for (let i = 0; i < 7; i++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      dates.push(date.toISOString().split("T")[0]);
    }

    return dates;
  }

  router.get("/today-basic-summary", async (req, res) => {
    try {
      // 📅 Get today's date (UK logic as you already use)
      const today = getUKDate();

      // 📆 Detect weekday / weekend
      const dayOfWeek = new Date(today).getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const sessionType = isWeekend ? "weekend" : "weekdays";

      // 1️⃣ Get ACTIVE classes for today
      const todaysClasses = await classesCollection
        .find({
          session: sessionType,
          activity: { $ne: "inactive" },
        })
        .project({ _id: 1 })
        .toArray();

      // Convert class IDs to STRING (CRITICAL)
      const classIds = todaysClasses.map((cls) => cls._id.toString());

      // 2️⃣ Get ACTIVE + ENROLLED students linked to these classes
      const students = await studentsCollection
        .find({
          status: "enrolled",
          activity: "active",
          "academic.enrollments.class_id": { $in: classIds },
        })
        .project({
          _id: 1,
          "academic.enrollments.class_id": 1,
        })
        .toArray();

      // 3️⃣ Count expected students (SAFE & CORRECT)
      let totalExpectedStudents = 0;

      for (const student of students) {
        if (!student.academic?.enrollments) continue;

        const matchedEnrollments = student.academic.enrollments.filter((en) =>
          classIds.includes(en.class_id),
        );

        totalExpectedStudents += matchedEnrollments.length;
      }

      // 4️⃣ Response
      res.send({
        success: true,
        date: today,
        session_type: sessionType,
        summary: {
          total_classes_today: classIds.length,
          total_expected_students: totalExpectedStudents,
        },
        message: `Today has ${classIds.length} ${sessionType} classes with ${totalExpectedStudents} expected students.`,
      });
    } catch (error) {
      console.error("Today basic summary error:", error);
      res.status(500).send({
        success: false,
        message: "Failed to load today summary",
        error: error.message,
      });
    }
  });

  return router;
};
