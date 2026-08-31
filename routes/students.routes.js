const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
const sendApprovalEmail = require("../config/sendApprovalEmail");
const buildStudentAggregationPipeline = require("../config/buildStudentAggregationPipeline");
const {
  uploadToCloudinary,
  generateStudentReport,
} = require("../config/generateReport");
const {
  buildStudentYearlySummaryPipeline,
  buildYearlySummaryPipeline,
} = require("../utils/lessonsCoveredUtils");
// Helper function to format month display
function formatDisplayMonth(monthKey) {
  const [year, month] = monthKey.split("-");
  const monthNames = [
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
  const monthName = monthNames[parseInt(month) - 1] || month;
  return `${monthName} ${year}`;
}
// Accept the studentsCollection via parameter
module.exports = (
  studentsCollection,
  verifyToken,
  familiesCollection,
  classesCollection,
  groupsCollection,
  countersCollection, // Receive the collection
  attendancesCollection,
  lessonsCoveredCollection,
  meritsCollection,
  feesCollection,
  yearlyReportsCollection, // Receive the collection
) => {
  async function getNextSequenceValue(sequenceName) {
    try {
      // First try to find and update the counter
      const result = await countersCollection.findOneAndUpdate(
        { _id: sequenceName },
        { $inc: { sequence_value: 1 } },
        {
          returnDocument: "after", // Use this for newer drivers
          upsert: true,
        },
      );

      // Handle different response formats based on driver version
      if (result && result.value) {
        // Newer driver versions (4.x+)
        return result.value.sequence_value;
      } else if (result && result.sequence_value !== undefined) {
        // Some versions might return the document directly
        return result.sequence_value;
      } else if (
        result &&
        result.lastErrorObject &&
        result.lastErrorObject.updatedExisting
      ) {
        // For older drivers (3.x), we need to fetch the current value
        const currentCounter = await countersCollection.findOne({
          _id: sequenceName,
        });
        return currentCounter.sequence_value;
      } else {
        // If all else fails, manually handle the counter
        const currentCounter = await countersCollection.findOne({
          _id: sequenceName,
        });
        if (!currentCounter) {
          // Create the counter if it doesn't exist
          await countersCollection.insertOne({
            _id: sequenceName,
            sequence_value: 1,
          });
          return 1;
        }
        return currentCounter.sequence_value;
      }
    } catch (error) {
      // Fallback: manually handle the counter operation
      try {
        const currentCounter = await countersCollection.findOne({
          _id: sequenceName,
        });

        if (!currentCounter) {
          // Create counter with initial value 1
          await countersCollection.insertOne({
            _id: sequenceName,
            sequence_value: 1,
          });
          return 1;
        }

        // Increment and update manually
        const newValue = currentCounter.sequence_value + 1;
        await countersCollection.updateOne(
          { _id: sequenceName },
          { $set: { sequence_value: newValue } },
        );

        return newValue;
      } catch (fallbackError) {
        throw new Error(`Failed to get sequence value for ${sequenceName}`);
      }
    }
  }
  // 🔹 GET: All students with department/class names
  router.get("/", async (req, res) => {
    try {
      // First, verify the collection exists
      const collectionExists = await studentsCollection.countDocuments();
      if (collectionExists === 0) {
        return res.status(404).send({ error: "Students collection is empty" });
      }

      // Debug: Log the pipeline before execution
      const pipeline = buildStudentAggregationPipeline();

      // Execute the aggregation with error handling
      const cursor = studentsCollection.aggregate(pipeline);
      const result = await cursor.toArray();

      if (!result || result.length === 0) {
        return res.status(404).send({
          error: "No students found",
          warning: "Pipeline executed successfully but returned no results",
        });
      }

      res.send(result);
    } catch (error) {
      console.error("Aggregation Error:", error);
      res.status(500).send({
        error: "Failed to fetch students",
        details: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  });

  // Get total number of teachers with gender and activity breakdown
  router.get("/count", async (req, res) => {
    try {
      const total = await studentsCollection.countDocuments({
        activity: "active",
        status: "enrolled",
      });

      const maleCount = await studentsCollection.countDocuments({
        gender: "Male",
        activity: "active",
        status: "enrolled",
      });
      const femaleCount = await studentsCollection.countDocuments({
        gender: "Female",
        activity: "active",
        status: "enrolled",
      });

      const activeCount = await studentsCollection.countDocuments({
        status: "enrolled",
        activity: "active",
      });
      const inactiveCount = await studentsCollection.countDocuments({
        activity: "inactive",
      });

      // For session counts, we need to use aggregation since it's in an array
      const sessionCounts = await studentsCollection
        .aggregate([
          {
            $match: {
              status: "enrolled",
              activity: "active",
            },
          },
          {
            $unwind: "$academic.enrollments",
          },
          {
            $group: {
              _id: "$academic.enrollments.session",
              count: { $sum: 1 },
            },
          },
        ])
        .toArray();

      // Convert aggregation result to the format you need
      let weekdaysCount = 0;
      let weekendCount = 0;

      sessionCounts.forEach((session) => {
        if (session._id === "weekdays") {
          weekdaysCount = session.count;
        } else if (session._id === "weekend") {
          weekendCount = session.count;
        }
      });

      // If you also want department counts, you can add this aggregation
      const departmentCounts = await studentsCollection
        .aggregate([
          {
            $match: {
              status: "enrolled",
              activity: "active",
            },
          },
          {
            $unwind: "$academic.enrollments",
          },
          {
            $group: {
              _id: "$academic.enrollments.department",
              count: { $sum: 1 },
              // activity: "active",
              // status: "enrolled",
            },
          },
        ])
        .toArray();

      res.send({
        total,
        gender: {
          male: maleCount,
          female: femaleCount,
        },
        activity: {
          active: activeCount,
          inactive: inactiveCount,
        },
        session: {
          weekdays: weekdaysCount,
          weekend: weekendCount,
        },
        // departments: departmentCounts // Optional: include department counts
      });
    } catch (error) {
      res.status(500).send({ message: "Failed to count students", error });
    }
  });
  // 🔹 GET: Students without enrolled or hold status
  router.get("/without-enrolled", async (req, res) => {
    try {
      const result = await studentsCollection
        .aggregate(
          buildStudentAggregationPipeline({
            status: { $nin: ["enrolled", "hold", "rejected"] },
          }),
        )
        .toArray();
      res.send(result);
    } catch (error) {
      res.status(500).send({ error: "Failed to fetch students" });
    }
  });

  // 🔹 GET: Students by specific status
  router.get("/get-by-status/:status", async (req, res) => {
    const status = req.params.status;
    try {
      const result = await studentsCollection
        .aggregate(buildStudentAggregationPipeline({ status }))
        .toArray();
      res.send(result);
    } catch (error) {
      res.status(500).send({ error: "Failed to fetch students" });
    }
  });

  // 🔹 GET: Single student by ID (with department/class info)
  router.get("/by-id/:id", async (req, res) => {
    const id = req.params.id;
    try {
      const student = await studentsCollection
        .aggregate(buildStudentAggregationPipeline({ _id: new ObjectId(id) }))
        .toArray();

      if (!student.length) {
        return res.status(404).send({ message: "Student not found" });
      }

      res.send(student[0]);
    } catch (error) {
      res.status(500).send({ error: "Failed to fetch student" });
    }
  });
  // 🔹 GET: Student by email
  router.get("/by-email/:email", async (req, res) => {
    const { email } = req.params;
    try {
      const students = await studentsCollection
        .find({ email }, { projection: { _id: 1, name: 1 } }) // only return _id and name
        .toArray();
      if (!students.length) {
        return res.status(404).send({ message: "Student not found" });
      }

      res.send(students); // send array with only _id & name
    } catch (error) {
      res.status(500).send({ error: "Failed to fetch student by email" });
    }
  });

  // GET /students/by-group/:classId  (classId comes from classes collection)

  router.get("/by-group/:classId", async (req, res) => {
    try {
      const { classId } = req.params;

      // 1️⃣ Sanity-check the ID
      if (!ObjectId.isValid(classId))
        return res.status(400).send({ message: "Invalid class ID" });

      // 2️⃣ Fetch the class we want to match against
      const cls = await classesCollection.findOne({
        _id: new ObjectId(classId),
      });

      if (!cls) return res.status(404).send({ message: "Class not found" });

      // 3️⃣ CORRECTED: Build the aggregation pipeline
      const matchStage = {
        $match: {
          $and: [
            { status: { $in: ["enrolled", "hold"] } }, // Fixed: removed $ prefix
            { activity: "active" }, // Fixed: removed $ prefix
            {
              $expr: {
                $gt: [
                  {
                    $size: {
                      $ifNull: [
                        {
                          $filter: {
                            input: "$academic.enrollments",
                            as: "enrollment",
                            cond: {
                              $and: [
                                // Match dept_id (use deptObjectId if available, otherwise dept_id)
                                {
                                  $or: [
                                    {
                                      $eq: [
                                        "$$enrollment.deptObjectId",
                                        cls.dept_id,
                                      ],
                                    },
                                    {
                                      $eq: [
                                        "$$enrollment.dept_id",
                                        cls.dept_id,
                                      ],
                                    },
                                  ],
                                },
                                // Match class_id (it's stored as string in enrollments)
                                { $eq: ["$$enrollment.class_id", classId] },
                                { $eq: ["$$enrollment.session", cls.session] },
                                {
                                  $eq: [
                                    "$$enrollment.session_time",
                                    cls.session_time,
                                  ],
                                },
                              ],
                            },
                          },
                        },
                        [], // Default to empty array if academic.enrollments is null
                      ],
                    },
                  },
                  0, // At least one enrollment matches
                ],
              },
            },
          ],
        },
      };

      // 4️⃣ PROJECTION - Keep all fields and filter enrollments
      const projectMatchingEnrollment = {
        $project: {
          // Include all student fields
          name: 1,
          email: 1,
          status: 1,
          activity: 1,
          // Include all other fields you need
          "mother.name": 1,
          "father.name": 1,
          emergency_number: 1,
          family_name: 1,
          school_year: 1,
          gender: 1,
          dob: 1,
          startingDate: 1,
          student_id: 1,
          createdAt: 1,
          uid: 1,
          parentUid: 1,
          address: 1,
          post_code: 1,
          language: 1,
          signature: 1,
          monthly_fee: 1,

          // Filter academic to only show the matching enrollment
          academic: {
            enrollments: {
              $filter: {
                input: "$academic.enrollments",
                as: "enrollment",
                cond: {
                  $and: [
                    // Match dept_id (use deptObjectId if available, otherwise dept_id)
                    {
                      $or: [
                        { $eq: ["$$enrollment.deptObjectId", cls.dept_id] },
                        { $eq: ["$$enrollment.dept_id", cls.dept_id] },
                      ],
                    },
                    // Match class_id (it's stored as string in enrollments)
                    { $eq: ["$$enrollment.class_id", classId] },
                    { $eq: ["$$enrollment.session", cls.session] },
                    { $eq: ["$$enrollment.session_time", cls.session_time] },
                  ],
                },
              },
            },
          },
        },
      };

      const students = await studentsCollection
        .aggregate([matchStage, projectMatchingEnrollment])
        .toArray();

      res.send(students);
    } catch (err) {
      console.error("Error in by-group route:", err);
      res.status(500).send({ error: "Internal Server Error" });
    }
  });
  router.get("/by-activity/:activity", async (req, res) => {
    const activity = req.params.activity;
    const { search } = req.query;
    try {
      const matchCriteria = {
        activity: activity,
        status: { $in: ["enrolled", "hold"] },
      };

      // Add search criteria if search term exists
      if (search && search.trim() !== "") {
        matchCriteria.$or = [
          { name: { $regex: search, $options: "i" } },
          { "father.name": { $regex: search, $options: "i" } },
          { "mother.name": { $regex: search, $options: "i" } },
          { "father.occupation": { $regex: search, $options: "i" } },
          { "mother.occupation": { $regex: search, $options: "i" } },
        ];
      }
      const students = await studentsCollection
        .aggregate([
          ...buildStudentAggregationPipeline(matchCriteria),
          {
            $addFields: {
              parsedStartingDate: {
                $cond: {
                  if: {
                    $and: [
                      { $ne: ["$startingDate", null] },
                      { $ne: ["$startingDate", ""] },
                    ],
                  },
                  then: {
                    $dateFromString: {
                      dateString: "$startingDate",
                      format: "%Y-%m-%d",
                    },
                  },
                  else: new Date("9999-12-31"), // far future date so nulls go last
                },
              },
            },
          },
          { $sort: { parsedStartingDate: -1 } },
          { $project: { parsedStartingDate: 0 } },
          {
            $project: {
              _id: 1, // optional if you want to keep the ID,
              uid: 1,
              name: 1,
              email: 1,
              academic: 1,
              monthly_fee: 1,
              status: 1,
              activity: 1,
              startingDate: 1,
              student_id: 1,
            },
          },
        ])
        .toArray();

      res.send(students);
    } catch (error) {
      console.error("Search error:", error);
      res.status(500).send({
        error: "Failed to fetch students",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  });
  // Create new student
  router.post("/", async (req, res) => {
    const newStudent = req.body;

    try {
      // Get the next sequential student ID
      const studentId = await getNextSequenceValue("studentId");

      // Add the sequential ID to the student data
      newStudent.student_id = studentId;

      // If not found, insert new student
      const result = await studentsCollection.insertOne(newStudent);

      res.status(201).send({
        ...result,
        student_id: studentId, // Include the sequential ID in the response
      });
    } catch (error) {
      console.error("Error creating student:", error);
      res.status(500).send({ message: "Internal Server Error" });
    }
  });

  // Update student
  router.put("/:id", async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const studentData = req.body;
    const updatedDoc = {
      $set: { ...studentData },
    };
    const result = await studentsCollection.updateOne(query, updatedDoc, {
      upsert: true,
    });
    res.send(result);
  });
  // 🔹 POST: Generate PDF and update student document with reportPdf field
  // In students.routes.js - Replace the /generate-student-report/:id endpoint

  // ===== GET STUDENT YEARLY REPORTS =====
  // Helper function to get student's yearly reports for a specific year
  async function getStudentYearlyReports(
    studentId,
    year,
    yearlyReportsCollection,
  ) {
    try {
      // Build academic year string (e.g., "2025-2026")
      const academicYear = `${year}-${year + 1}`;

      // Find both beginning and end of year reports
      const reports = await yearlyReportsCollection
        .find({
          student_id: studentId,
          academic_year: academicYear,
        })
        .toArray();

      return {
        year: year.toString(),
        academic_year: academicYear,
        beginning:
          reports.find((r) => r.report_type === "beginning_of_year") || null,
        ending: reports.find((r) => r.report_type === "end_of_year") || null,
        hasBeginning: reports.some(
          (r) => r.report_type === "beginning_of_year",
        ),
        hasEnding: reports.some((r) => r.report_type === "end_of_year"),
        notes: reports.reduce((acc, r) => {
          if (r.notes && r.notes.length > 0) {
            acc = [...acc, ...r.notes];
          }
          return acc;
        }, []),
        type: reports.length > 0 ? reports[0].type : "normal",
      };
    } catch (error) {
      console.error(`Error fetching reports for year ${year}:`, error);
      return {
        year: year.toString(),
        academic_year: `${year}-${year + 1}`,
        beginning: null,
        ending: null,
        hasBeginning: false,
        hasEnding: false,
        notes: [],
        type: "normal",
        error: error.message,
      };
    }
  }

  // Helper function to format lesson data for report
  function formatYearlyReportData(report, type) {
    if (!report || !report.lessons) return null;

    const lessons = report.lessons;
    const formatted = {
      type: report.type || type || "normal",
      date: report.created_at || report.date,
      subjects: {},
    };

    // Qaidah/Quran
    if (lessons.qaidah_quran) {
      const q = lessons.qaidah_quran;
      if (q.selected === "quran" || q.selected === "hifz") {
        formatted.subjects.qaidah_quran = {
          selected: q.selected,
          type: "Quran/Hifz",
          para: q.data?.para || "N/A",
          page: q.data?.page || "N/A",
          line: q.data?.line || "N/A",
        };
      } else {
        formatted.subjects.qaidah_quran = {
          selected: q.selected,
          type: "Qaidah/Tajweed",
          level: q.data?.level || "N/A",
          lesson_name: q.data?.lesson_name || "N/A",
          page: q.data?.page || "N/A",
          line: q.data?.line || "N/A",
        };
      }
    }

    // Islamic Studies
    if (type === "normal" && lessons.islamic_studies) {
      const is = lessons.islamic_studies;
      formatted.subjects.islamic_studies = {
        book: is.book || "N/A",
        page: is.page || "N/A",
        lesson_name: is.lesson_name || "N/A",
      };
    }

    // Dua/Surah
    if (type === "normal" && lessons.dua_surah) {
      const ds = lessons.dua_surah;
      formatted.subjects.dua_surah = {
        book: ds.book || "N/A",
        level: ds.level || "N/A",
        page: ds.page || "N/A",
        target: ds.target || "N/A",
        dua_number: ds.dua_number || "N/A",
        lesson_name: ds.lesson_name || "N/A",
      };
    }

    // Gift for Muslim
    if (type === "gift_muslim" && lessons.gift_for_muslim) {
      const gm = lessons.gift_for_muslim;
      formatted.subjects.gift_for_muslim = {
        level: gm.level || "N/A",
        lesson_name: gm.lesson_name || "N/A",
        page: gm.page || "N/A",
        target: gm.target || "N/A",
      };
    }

    return formatted;
  }

  // ===== UPDATED: Generate Student Report =====
  router.post("/generate-student-report/:id", async (req, res) => {
    try {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          error: "Invalid student ID format",
        });
      }

      // 1️⃣ Fetch student using shared aggregation pipeline
      const students = await studentsCollection
        .aggregate(buildStudentAggregationPipeline({ _id: new ObjectId(id) }))
        .toArray();

      if (!students.length) {
        return res.status(404).json({
          success: false,
          error: "Student not found",
        });
      }

      const studentData = students[0];
      const student_id = studentData._id.toString();

      // 2. Fetch attendance data (keep same)
      const attendanceSummary = await attendancesCollection
        .aggregate([
          {
            $match: {
              student_id: student_id,
              attendance: "student",
            },
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
            },
          },
        ])
        .toArray();

      const attendanceData =
        attendanceSummary.length > 0
          ? attendanceSummary[0]
          : {
              total: 0,
              present: 0,
              absent: 0,
              late: 0,
            };

      // 3. Fetch merit data (keep same)
      const meritRecords = await meritsCollection
        .find({
          student_id: student_id,
        })
        .sort({ date: -1 })
        .limit(10)
        .toArray();

      const totalMeritPoints = meritRecords.reduce(
        (sum, record) => sum + (record.merit_points || 0),
        0,
      );
      const totalAwards = meritRecords.length;
      const averagePoints =
        totalAwards > 0 ? totalMeritPoints / totalAwards : 0;

      const behaviorBreakdown = {};
      meritRecords.forEach((record) => {
        const behavior = record.behavior || "Other";
        if (!behaviorBreakdown[behavior]) {
          behaviorBreakdown[behavior] = {
            count: 0,
            totalPoints: 0,
            averagePoints: 0,
          };
        }
        behaviorBreakdown[behavior].count++;
        behaviorBreakdown[behavior].totalPoints += record.merit_points || 0;
        behaviorBreakdown[behavior].averagePoints =
          behaviorBreakdown[behavior].totalPoints /
          behaviorBreakdown[behavior].count;
      });

      const meritSummary = {
        totalMeritPoints,
        totalAwards,
        averagePoints,
        recentMerits: meritRecords.slice(0, 6),
        behaviorBreakdown,
      };

      // 4. Fetch fee data (keep same - already working)
      let feeSummary = {
        totalPaid: 0,
        outstandingAmount: 0,
        lastPaymentDate: null,
        paymentStatus: "No payment records",
        unpaidMonths: [],
        partiallyPaidMonths: [],
        fullyPaidMonths: [],
        monthlyFee: studentData.monthly_fee || 50,
        paidMonthsCount: 0,
        partiallyPaidMonthsCount: 0,
        unpaidMonthsCount: 0,
      };

      // ... (keep your existing fee processing logic)

      // 5. Calculate years range
      const currentYearNum = new Date().getFullYear();
      let startingYear = currentYearNum;

      if (studentData.startingDate) {
        const startDate = new Date(studentData.startingDate);
        startingYear = startDate.getFullYear();
      }

      // 6. ===== UPDATED: Fetch yearly reports from yearly_reports collection =====
      const allYearsReportsData = [];

      for (let year = startingYear; year <= currentYearNum; year++) {
        const yearlyData = await getStudentYearlyReports(
          student_id,
          year,
          yearlyReportsCollection, // Make sure this is passed to the router
        );

        // Format the data for the report
        const formattedData = {
          year: yearlyData.year,
          academic_year: yearlyData.academic_year,
          type: yearlyData.type,
          beginning: yearlyData.beginning
            ? formatYearlyReportData(yearlyData.beginning, yearlyData.type)
            : null,
          ending: yearlyData.ending
            ? formatYearlyReportData(yearlyData.ending, yearlyData.type)
            : null,
          hasBeginning: yearlyData.hasBeginning,
          hasEnding: yearlyData.hasEnding,
          notes: yearlyData.notes,
        };

        allYearsReportsData.push(formattedData);
      }

      // 7. Generate PDF with comprehensive data
      const pdfResult = await generateStudentReport(studentData, {
        attendance: attendanceData,
        yearlyReports: allYearsReportsData, // Changed from 'lessons' to 'yearlyReports'
        merits: meritSummary,
        fees: feeSummary,
        startingYear: startingYear,
        currentYear: currentYearNum,
        reportType: "yearly", // Indicate this is yearly report
      });

      // 8. Upload to Cloudinary
      const cloudinaryUrl = await uploadToCloudinary(
        pdfResult.pdfBuffer,
        pdfResult.fileName,
      );

      // 9. Update student document
      await studentsCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            reportPdf: cloudinaryUrl,
          },
        },
      );

      // 10. Return response
      res.status(200).json({
        success: true,
        message: `Comprehensive yearly report generated successfully (${startingYear}-${currentYearNum})`,
        reportUrl: cloudinaryUrl,
        reportId: pdfResult.reportId,
        studentId: id,
        studentName: studentData.name,
        yearsCovered: {
          from: startingYear,
          to: currentYearNum,
          totalYears: currentYearNum - startingYear + 1,
        },
        dataSummary: {
          attendanceRecords: attendanceData.total,
          yearsWithReports: allYearsReportsData.filter(
            (d) => d.hasBeginning || d.hasEnding,
          ).length,
          totalYearsCovered: allYearsReportsData.length,
          totalMeritPoints: meritSummary.totalMeritPoints,
          totalMeritAwards: meritSummary.totalAwards,
          outstandingAmount: feeSummary.outstandingAmount,
          paymentStatus: feeSummary.paymentStatus,
        },
      });
    } catch (error) {
      console.error("Comprehensive report generation error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to generate comprehensive report",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  });

  router.patch("/update-activity/:id", async (req, res) => {
    const studentId = req.params.id;
    if (!ObjectId.isValid(studentId)) {
      return res.status(400).send({ message: "Invalid student ID format" });
    }

    const query = { _id: new ObjectId(studentId) };
    const { activity } = req.body;

    // Get the student first to check current activity and get family info
    const student = await studentsCollection.findOne(query);

    if (!student) {
      return res.status(404).send({ message: "Student not found" });
    }

    // If activating an inactive student (changing from inactive to active)
    const isActivating =
      student.activity === "inactive" && activity === "active";
    const isDeactivating =
      student.activity === "active" && activity === "inactive";

    // Prepare the update object
    const updatedDoc = {
      $set: { activity },
    };

    // If deactivating, add deactivatedAt timestamp
    if (isDeactivating) {
      updatedDoc.$set.deactivatedAt = new Date();
    }

    // If activating, remove deactivatedAt field
    if (isActivating) {
      updatedDoc.$unset = { deactivatedAt: "" };
    }

    const result = await studentsCollection.updateOne(query, updatedDoc);

    // If activating the student, restore the family and add student back
    if (isActivating && student.email) {
      // Find the family by email
      const family = await familiesCollection.findOne({
        email: student.email,
      });

      if (family) {
        // Prepare update object for family
        const familyUpdate = {
          $addToSet: { children: student.uid }, // Add student back to children array
        };

        // If family was deleted, restore it (ONLY SET TO FALSE, NEVER SET TO TRUE)
        if (family.isDeleted === true) {
          familyUpdate.$set = { isDeleted: false };
        }

        // Update the family
        await familiesCollection.updateOne(
          { email: student.email },
          familyUpdate,
        );
      } else {
        console.log(`No family found with email: ${student.email}`);
      }
    }

    // ✅ COMPLETELY REMOVED: The code that marks family as deleted
    // NEVER automatically set isDeleted to true

    res.send({
      ...result,
      message: isActivating
        ? "Student activated, deactivatedAt removed, family restored (if it was deleted)"
        : isDeactivating
          ? "Student deactivated with deactivatedAt timestamp"
          : "Student activity updated",
    });
  });

  // Update student status

  router.patch("/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!status) {
        return res.status(400).json({ error: "Status is required" });
      }

      const result = await studentsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } },
      );
      // 2. Fetch the updated student
      const student = await studentsCollection.findOne({
        _id: new ObjectId(id),
      });

      // 3. If approved, send email
      if (status === "approved") {
        await sendApprovalEmail({
          to: student?.email,
          name: student?.family_name,
          studentName: student?.name,
        });
      }

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // Delete student
  // DELETE /students/:id
  router.delete("/:id", async (req, res) => {
    const id = req.params.id;

    // 1. Find the student first to get UID
    const student = await studentsCollection.findOne({ _id: new ObjectId(id) });

    if (!student) {
      return res.status(404).send({ message: "Student not found" });
    }

    const studentUid = student.uid;

    // 2. Delete the student
    const result = await studentsCollection.deleteOne({
      _id: new ObjectId(id),
    });

    // 3. Remove student UID from family (but don't delete the family)
    await familiesCollection.updateOne(
      { children: studentUid },
      { $pull: { children: studentUid } },
    );

    res.send(result);
  });
  // GET monthly admissions (enrolled students who joined in a specific month)
  // GET monthly admissions (enrolled students who joined in a specific month)
  router.get("/monthly-admissions", async (req, res) => {
    try {
      const { year, month } = req.query;

      if (!year || !month) {
        return res.status(400).json({ error: "Year and month are required" });
      }

      // Create date range for the selected month
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0);

      // Format dates to YYYY-MM-DD for comparison
      const startDateStr = startDate.toISOString().split("T")[0];
      const endDateStr = endDate.toISOString().split("T")[0];

      // Build the match criteria
      const matchCriteria = {
        startingDate: {
          $gte: startDateStr,
          $lte: endDateStr,
        },
        status: "enrolled",
        activity: "active",
      };

      // Use the existing aggregation pipeline
      const students = await studentsCollection
        .aggregate(buildStudentAggregationPipeline(matchCriteria))
        .toArray();

      // Extract class, department and session info from the aggregated data
      const studentsWithInfo = students.map((student) => {
        // Get the first enrollment from the enriched academic array
        const enrollment = student.academic?.enrollments?.[0] || {};

        return {
          _id: student._id,
          name: student.name,
          class_name: enrollment.class || student.school_year || "Not Assigned",
          dept_name: enrollment.department || "Not Assigned",
          session: enrollment.session || "weekdays",
          startingDate: student.startingDate,
          student_id: student.student_id,
        };
      });

      // Calculate session breakdown
      const weekdaysCount = studentsWithInfo.filter(
        (s) => s.session === "weekdays",
      ).length;
      const weekendCount = studentsWithInfo.filter(
        (s) => s.session === "weekend",
      ).length;

      res.json({
        success: true,
        count: studentsWithInfo.length,
        weekdays: weekdaysCount,
        weekend: weekendCount,
        students: studentsWithInfo,
      });
    } catch (error) {
      console.error("Error fetching monthly admissions:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET monthly departures (enrolled students who became inactive in a specific month)
  router.get("/monthly-departures", async (req, res) => {
    try {
      const { year, month } = req.query;

      if (!year || !month) {
        return res.status(400).json({ error: "Year and month are required" });
      }

      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0);

      // Build the match criteria
      const matchCriteria = {
        status: "enrolled",
        activity: "inactive",
        $or: [
          { deactivatedAt: { $gte: startDate, $lte: endDate } },
          {
            deactivatedAt: { $exists: false },
            updatedAt: { $gte: startDate, $lte: endDate },
          },
        ],
      };

      // Use the existing aggregation pipeline
      const students = await studentsCollection
        .aggregate(buildStudentAggregationPipeline(matchCriteria))
        .toArray();

      const studentsWithInfo = students.map((student) => {
        const enrollment = student.academic?.enrollments?.[0] || {};

        return {
          _id: student._id,
          name: student.name,
          class_name: enrollment.class || student.school_year || "Not Assigned",
          dept_name: enrollment.department || "Not Assigned",
          session: enrollment.session || "weekdays",
          deactivatedAt: student.deactivatedAt || student.updatedAt,
          student_id: student.student_id,
        };
      });

      const weekdaysCount = studentsWithInfo.filter(
        (s) => s.session === "weekdays",
      ).length;
      const weekendCount = studentsWithInfo.filter(
        (s) => s.session === "weekend",
      ).length;

      res.json({
        success: true,
        count: studentsWithInfo.length,
        weekdays: weekdaysCount,
        weekend: weekendCount,
        students: studentsWithInfo,
      });
    } catch (error) {
      console.error("Error fetching monthly departures:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET class departure statistics (which classes have most enrolled students leaving)
  router.get("/class-departure-stats", async (req, res) => {
    try {
      const { year, month } = req.query;

      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0);

      // Build the match criteria
      const matchCriteria = {
        status: "enrolled",
        activity: "inactive",
        $or: [
          { deactivatedAt: { $gte: startDate, $lte: endDate } },
          {
            deactivatedAt: { $exists: false },
            updatedAt: { $gte: startDate, $lte: endDate },
          },
        ],
      };

      // Use the existing aggregation pipeline
      const students = await studentsCollection
        .aggregate(buildStudentAggregationPipeline(matchCriteria))
        .toArray();

      // Group by class name and session
      const classStats = {};

      students.forEach((student) => {
        const enrollment = student.academic?.enrollments?.[0] || {};
        const className =
          enrollment.class || student.school_year || "Not Assigned";
        const session = enrollment.session || "weekdays";

        if (!classStats[className]) {
          classStats[className] = {
            total: 0,
            weekdays: 0,
            weekend: 0,
          };
        }

        classStats[className].total++;
        if (session === "weekdays") {
          classStats[className].weekdays++;
        } else if (session === "weekend") {
          classStats[className].weekend++;
        }
      });

      // Convert to array and sort by total
      const result = Object.entries(classStats)
        .map(([className, stats]) => ({
          _id: className,
          total: stats.total,
          weekdays: stats.weekdays,
          weekend: stats.weekend,
        }))
        .filter((item) => item._id !== "Not Assigned")
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

      res.json({
        success: true,
        classes: result,
      });
    } catch (error) {
      console.error("Error fetching class departure stats:", error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
};
