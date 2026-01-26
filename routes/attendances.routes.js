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

  // Keep the original route with date parameter as well for historical data
  // router.get("/dashboard-summary/:date", async (req, res) => {
  //   try {
  //     const { date } = req.params;
  //     const today = date || new Date().toISOString().split("T")[0];
  //     console.log("Processing simplified dashboard for date:", today);

  //     // Get day of week (0=Sunday, 1=Monday, ..., 6=Saturday)
  //     const dayOfWeek = new Date(today).getDay();
  //     const isWeekend = dayOfWeek === 0 || dayOfWeek === 6; // Sunday=0, Saturday=6
  //     const sessionType = isWeekend ? "weekend" : "weekdays";

  //     // Get all classes based on today's session type
  //     const todaysClasses = await classesCollection
  //       .find({
  //         session: sessionType,
  //       })
  //       .toArray();

  //     const todaysClassIds = todaysClasses.map((cls) => cls._id.toString());

  //     // If no classes today, return early
  //     if (todaysClassIds.length === 0) {
  //       return res.send({
  //         date: today,
  //         sessionType: sessionType,
  //         message: `No ${sessionType} classes scheduled for today.`,
  //         teachers_with_attendance: [],
  //         teachers_without_attendance: [],
  //         classes_without_attendance: [], // NEW: Show classes without attendance
  //         absent_students: [],
  //       });
  //     }

  //     // Get teachers who have classes assigned for today's session type
  //     const teachers = await teachersCollection
  //       .find({
  //         status: "approved",
  //         activity: "active",
  //         class_ids: { $in: todaysClassIds },
  //       })
  //       .project({
  //         _id: 1,
  //         name: 1,
  //         class_ids: 1,
  //       })
  //       .toArray();

  //     // Get attendance for today
  //     const todaysAttendance = await attendancesCollection
  //       .find({
  //         date: today,
  //       })
  //       .toArray();

  //     // Track which classes have any student attendance
  //     const classesWithAttendance = new Set();
  //     const studentAttendanceMap = new Map(); // For checking absent students

  //     todaysAttendance.forEach((record) => {
  //       if (record.attendance === "student") {
  //         classesWithAttendance.add(record.class_id);
  //         const key = `${record.student_id}_${record.class_id}`;
  //         studentAttendanceMap.set(key, record);
  //       }
  //     });

  //     // Create class name map
  //     const classNameMap = new Map(
  //       todaysClasses.map((cls) => [cls._id.toString(), cls.class_name]),
  //     );

  //     // NEW: Find classes without ANY attendance
  //     const classesWithoutAttendance = [];
  //     for (const classId of todaysClassIds) {
  //       if (!classesWithAttendance.has(classId)) {
  //         const className = classNameMap.get(classId) || "Unknown Class";

  //         // Find teachers for this class
  //         const teachersForThisClass = teachers
  //           .filter((teacher) =>
  //             teacher.class_ids?.some((id) => id.toString() === classId),
  //           )
  //           .map((teacher) => ({
  //             teacher_id: teacher._id,
  //             teacher_name: teacher.name,
  //           }));

  //         classesWithoutAttendance.push({
  //           class_id: classId,
  //           class_name: className,
  //           teachers: teachersForThisClass,
  //           message: "No attendance taken for this class",
  //         });
  //       }
  //     }

  //     // Process teachers - who has given attendance and who hasn't
  //     const teachersWithAttendance = [];
  //     const teachersWithoutAttendance = [];

  //     for (const teacher of teachers) {
  //       const teacherClasses =
  //         teacher.class_ids?.filter((id) =>
  //           todaysClassIds.includes(id.toString()),
  //         ) || [];

  //       if (teacherClasses.length === 0) continue;

  //       // Check which classes this teacher has taken attendance for
  //       const attendedClasses = [];
  //       const notAttendedClasses = [];

  //       for (const classId of teacherClasses) {
  //         const classIdStr = classId.toString();
  //         const className = classNameMap.get(classIdStr) || "Unknown Class";

  //         const classAttendanceInfo = {
  //           class_id: classId,
  //           class_name: className,
  //           attendance_taken: classesWithAttendance.has(classIdStr),
  //         };

  //         if (classesWithAttendance.has(classIdStr)) {
  //           attendedClasses.push(classAttendanceInfo);
  //         } else {
  //           notAttendedClasses.push(classAttendanceInfo);
  //         }
  //       }

  //       const teacherData = {
  //         teacher_id: teacher._id,
  //         teacher_name: teacher.name,
  //         attended_classes: attendedClasses,
  //         not_attended_classes: notAttendedClasses,
  //         has_attendance_for_all_classes: notAttendedClasses.length === 0,
  //       };

  //       // Teacher is "with attendance" if they have ANY attended classes
  //       if (attendedClasses.length > 0) {
  //         teachersWithAttendance.push(teacherData);
  //       } else {
  //         teachersWithoutAttendance.push(teacherData);
  //       }
  //     }

  //     // Get absent students (only from classes where attendance was taken)
  //     const absentStudents = [];

  //     // Only check classes that have attendance taken
  //     for (const classId of Array.from(classesWithAttendance)) {
  //       const className = classNameMap.get(classId) || "Unknown Class";

  //       // Get all students in this class
  //       const studentsInClass = await studentsCollection
  //         .find({
  //           activity: "active",
  //           status: "enrolled",
  //           "academic.enrollments": {
  //             $elemMatch: {
  //               class_id: classId,
  //             },
  //           },
  //         })
  //         .project({
  //           _id: 1,
  //           name: 1,
  //         })
  //         .toArray();

  //       // Check each student's attendance
  //       for (const student of studentsInClass) {
  //         const attendanceKey = `${student._id.toString()}_${classId}`;
  //         const attendanceRecord = studentAttendanceMap.get(attendanceKey);

  //         // If no record or status is absent
  //         if (!attendanceRecord || attendanceRecord.status === "absent") {
  //           absentStudents.push({
  //             student_name: student.name,
  //             class_name: className,
  //             status: attendanceRecord?.status || "no_record",
  //           });
  //         }
  //       }
  //     }

  //     // Get present count for summary
  //     const totalClassesWithAttendance = classesWithAttendance.size;
  //     const totalTeachersCount =
  //       teachersWithAttendance.length + teachersWithoutAttendance.length;

  //     res.send({
  //       date: today,
  //       sessionType: sessionType,
  //       summary: {
  //         total_teachers: totalTeachersCount,
  //         teachers_with_attendance: teachersWithAttendance.length,
  //         teachers_without_attendance: teachersWithoutAttendance.length,
  //         total_classes_today: todaysClassIds.length,
  //         classes_with_attendance_taken: totalClassesWithAttendance,
  //         classes_without_attendance_taken: classesWithoutAttendance.length,
  //         total_absent_students: absentStudents.length,
  //       },
  //       teachers_with_attendance: teachersWithAttendance,
  //       teachers_without_attendance: teachersWithoutAttendance,
  //       classes_without_attendance: classesWithoutAttendance, // NEW: Shows which classes specifically
  //       absent_students: absentStudents.slice(0, 50), // First 50 absent students
  //       note:
  //         absentStudents.length > 50
  //           ? `Showing first 50 of ${absentStudents.length} absent students.`
  //           : `Found ${absentStudents.length} absent students.`,
  //     });
  //   } catch (error) {
  //     console.error("Error fetching simplified dashboard:", error);
  //     res.status(500).send({
  //       message: "Error fetching dashboard",
  //       error: error.message,
  //     });
  //   }
  // });
  return router;
};
