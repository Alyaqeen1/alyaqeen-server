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

      // 2. Fetch attendance data
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

      // 3. Fetch merit data (SIMPLIFIED VERSION)
      const meritRecords = await meritsCollection
        .find({
          student_id: student_id,
        })
        .sort({ date: -1 })
        .limit(10)
        .toArray();

      // Calculate merit summary
      const totalMeritPoints = meritRecords.reduce(
        (sum, record) => sum + (record.merit_points || 0),
        0,
      );
      const totalAwards = meritRecords.length;
      const averagePoints =
        totalAwards > 0 ? totalMeritPoints / totalAwards : 0;

      // Calculate behavior breakdown
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
        recentMerits: meritRecords.slice(0, 6), // Get first 6 (most recent)
        behaviorBreakdown,
      };

      // 4. Fetch fee data for the student (OUTSTANDING BALANCE) - WITH PARTIAL MONTHS LIST
      let feeSummary = {
        totalPaid: 0,
        outstandingAmount: 0,
        lastPaymentDate: null,
        paymentStatus: "No payment records",
        unpaidMonths: [], // Months with no payment
        partiallyPaidMonths: [], // Months with partial payment
        fullyPaidMonths: [], // Months fully paid
        monthlyFee: studentData.monthly_fee || 50,
        paidMonthsCount: 0,
        partiallyPaidMonthsCount: 0,
        unpaidMonthsCount: 0,
      };

      // Get family UID from student's parentUid
      const familyUid = studentData.parentUid;

      if (familyUid) {
        // First find the family by UID to get the familyId
        const family = await familiesCollection.findOne({ uid: familyUid });

        if (family) {
          const familyId = family._id.toString();
          const familyDiscount = family.discount || 0;
          const monthlyFee = studentData.monthly_fee || 50;
          const discountedMonthlyFee =
            familyDiscount > 0
              ? monthlyFee - (monthlyFee * familyDiscount) / 100
              : monthlyFee;

          // Get ALL fee records for this family
          const familyFees = await feesCollection
            .find({
              familyId: familyId,
              paymentType: {
                $in: [
                  "monthly",
                  "monthlyOnHold",
                  "admission",
                  "admissionOnHold",
                ],
              },
            })
            .toArray();

          // Track payment details for THIS SPECIFIC STUDENT
          const paymentDetails = new Map(); // monthStr -> { paid, due, status }
          let lastPaymentDate = null;
          let totalPaidAmount = 0;

          // Get joining month from student's startingDate
          let joiningMonth = null;
          let joiningYear = null;

          if (studentData.startingDate) {
            const startDate = new Date(studentData.startingDate);
            joiningMonth = startDate.getMonth() + 1;
            joiningYear = startDate.getFullYear();
          }

          // Process ADMISSION fees first (joining month is always paid)
          for (const fee of familyFees) {
            if (
              fee.paymentType === "admission" ||
              fee.paymentType === "admissionOnHold"
            ) {
              const studentFee = fee.students?.find(
                (s) => s.studentId === student_id,
              );

              if (
                studentFee &&
                studentFee.joiningMonth &&
                studentFee.joiningYear
              ) {
                const joinMonth = Number(studentFee.joiningMonth);
                const joinYear = Number(studentFee.joiningYear);
                const monthStr = `${joinYear}-${String(joinMonth).padStart(2, "0")}`;

                // Calculate first month payment
                const admissionFee = studentFee.admissionFee || 20;
                const subtotal = studentFee.subtotal || 0;
                const firstMonthPaid = Math.max(0, subtotal - admissionFee);
                const dueAmount = studentFee.discountedFee || monthlyFee;

                const status =
                  firstMonthPaid >= dueAmount
                    ? "paid"
                    : firstMonthPaid > 0
                      ? "partial"
                      : "unpaid";

                paymentDetails.set(monthStr, {
                  month: monthStr,
                  displayMonth: formatDisplayMonth(monthStr),
                  dueAmount: dueAmount,
                  paidAmount: firstMonthPaid,
                  remainingAmount: Math.max(0, dueAmount - firstMonthPaid),
                  status: status,
                  paymentDate: fee.payments?.[0]?.date || null,
                  paymentMethod: fee.payments?.[0]?.method || null,
                });

                totalPaidAmount += firstMonthPaid;

                // Track last payment date
                if (fee.payments && fee.payments.length > 0) {
                  lastPaymentDate = fee.payments[0].date;
                }
              }
            }
          }

          // Process MONTHLY fees
          for (const fee of familyFees) {
            if (
              fee.paymentType === "monthly" ||
              fee.paymentType === "monthlyOnHold"
            ) {
              // Only consider paid or pending fees
              if (fee.status !== "paid" && fee.status !== "pending") continue;

              const studentFee = fee.students?.find(
                (s) => s.studentId === student_id,
              );

              if (studentFee && Array.isArray(studentFee.monthsPaid)) {
                for (const mp of studentFee.monthsPaid) {
                  const monthNum = Number(mp.month);
                  const year = mp.year;
                  if (!isNaN(monthNum) && year) {
                    const monthStr = `${year}-${String(monthNum).padStart(2, "0")}`;
                    const paidAmount = mp.paid || 0;
                    const dueAmount =
                      mp.discountedFee || mp.monthlyFee || monthlyFee;

                    if (paidAmount > 0) {
                      const status =
                        paidAmount >= dueAmount ? "paid" : "partial";

                      paymentDetails.set(monthStr, {
                        month: monthStr,
                        displayMonth: formatDisplayMonth(monthStr),
                        dueAmount: dueAmount,
                        paidAmount: paidAmount,
                        remainingAmount: Math.max(0, dueAmount - paidAmount),
                        status: status,
                        paymentDate: fee.payments?.[0]?.date || null,
                        paymentMethod: fee.payments?.[0]?.method || null,
                      });

                      totalPaidAmount += paidAmount;
                    }

                    // Track last payment date
                    if (fee.payments && fee.payments.length > 0) {
                      lastPaymentDate = fee.payments[0].date;
                    }
                  }
                }
              }
            }
          }

          // Calculate months from September 2025 to current month
          const now = new Date();
          const currentYear = now.getFullYear();
          const currentMonth = now.getMonth() + 1;

          // Start from September 2025
          let startDate = new Date(2025, 8, 1); // September 2025

          // If student joined after September 2025, start from joining month
          if (joiningYear && joiningMonth) {
            const studentJoinDate = new Date(joiningYear, joiningMonth - 1, 1);
            if (studentJoinDate > startDate) {
              startDate = studentJoinDate;
            }
          }

          const fullyPaidMonths = [];
          const partiallyPaidMonths = [];
          const unpaidMonths = [];
          let totalOutstanding = 0;

          let checkDate = new Date(startDate);
          while (
            checkDate.getFullYear() < currentYear ||
            (checkDate.getFullYear() === currentYear &&
              checkDate.getMonth() + 1 <= currentMonth)
          ) {
            const y = checkDate.getFullYear();
            const m = checkDate.getMonth() + 1;
            const monthStr = `${y}-${String(m).padStart(2, "0")}`;

            // Check if we have payment for this month
            if (paymentDetails.has(monthStr)) {
              const payment = paymentDetails.get(monthStr);

              if (payment.status === "paid") {
                fullyPaidMonths.push(payment);
              } else if (payment.status === "partial") {
                partiallyPaidMonths.push(payment);
                totalOutstanding += payment.remainingAmount;
              }
            } else {
              // No payment record - check if this is joining month (should be paid by admission)
              const isJoiningMonth = joiningYear === y && joiningMonth === m;

              if (!isJoiningMonth) {
                unpaidMonths.push({
                  month: monthStr,
                  displayMonth: formatDisplayMonth(monthStr),
                  dueAmount: discountedMonthlyFee,
                  paidAmount: 0,
                  remainingAmount: discountedMonthlyFee,
                  status: "unpaid",
                });
                totalOutstanding += discountedMonthlyFee;
              }
            }

            checkDate.setMonth(checkDate.getMonth() + 1);
          }

          // Determine payment status
          let paymentStatus = "No payment records";

          if (
            fullyPaidMonths.length > 0 ||
            partiallyPaidMonths.length > 0 ||
            unpaidMonths.length > 0
          ) {
            if (unpaidMonths.length === 0 && partiallyPaidMonths.length === 0) {
              paymentStatus = "Fully Paid";
            } else if (
              unpaidMonths.length === 0 &&
              partiallyPaidMonths.length > 0
            ) {
              paymentStatus = "Partially Paid";
            } else if (unpaidMonths.length > 0) {
              paymentStatus = "Unpaid";
            }
          }

          feeSummary = {
            totalPaid: totalPaidAmount,
            outstandingAmount: totalOutstanding,
            lastPaymentDate: lastPaymentDate,
            paymentStatus: paymentStatus,
            unpaidMonths: unpaidMonths, // List of unpaid months
            partiallyPaidMonths: partiallyPaidMonths, // List of partially paid months
            fullyPaidMonths: fullyPaidMonths, // List of fully paid months
            monthlyFee: monthlyFee,
            discountedMonthlyFee: discountedMonthlyFee,
            familyDiscount: familyDiscount,
            paidMonthsCount: fullyPaidMonths.length,
            partiallyPaidMonthsCount: partiallyPaidMonths.length,
            unpaidMonthsCount: unpaidMonths.length,
            joiningMonth:
              joiningMonth && joiningYear
                ? `${joiningYear}-${String(joiningMonth).padStart(2, "0")}`
                : null,
          };
        }
      }

      // 5. Calculate years range (from joining year to current year)
      const currentYearNum = new Date().getFullYear();
      let startingYear = currentYearNum;

      if (studentData.startingDate) {
        const startDate = new Date(studentData.startingDate);
        startingYear = startDate.getFullYear();
      }

      // 6. Fetch lessons covered data for EACH YEAR using buildYearlySummaryPipeline
      const allYearsLessonsData = [];

      for (let year = startingYear; year <= currentYearNum; year++) {
        // Get yearly data using buildYearlySummaryPipeline
        const yearlyPipeline = buildYearlySummaryPipeline(year.toString());

        // Get ALL students data for this year
        const allYearlyData = await lessonsCoveredCollection
          .aggregate(yearlyPipeline)
          .toArray();

        // Filter to get ONLY this student's data
        const studentYearlyData = allYearlyData.filter((item) => {
          // Check if this is our student (student_id might be in different format)
          if (item.student_id && item.student_id.toString() === student_id) {
            return true;
          }
          // Also check student_name if student_id doesn't match
          if (item.student_name === studentData.name) {
            return true;
          }
          return false;
        });

        if (studentYearlyData.length > 0) {
          // Take the first matching record (should only be one per student per year)
          const yearData = {
            ...studentYearlyData[0],
            year: year.toString(),
          };
          allYearsLessonsData.push(yearData);
        } else {
          // Add empty year data if no records found
          allYearsLessonsData.push({
            year: year.toString(),
            progress: null,
            months_with_ending: 0,
            months_with_both: 0,
          });
        }
      }

      // 7. Generate PDF with comprehensive data INCLUDING MERIT AND FEE DATA
      const pdfResult = await generateStudentReport(studentData, {
        attendance: attendanceData,
        lessons: allYearsLessonsData,
        merits: meritSummary,
        fees: feeSummary, // Add fee data here
        startingYear: startingYear,
        currentYear: currentYearNum,
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
          yearsWithLessonsData: allYearsLessonsData.filter((d) => d.progress)
            .length,
          totalYearsCovered: allYearsLessonsData.length,
          totalMeritPoints: meritSummary.totalMeritPoints,
          totalMeritAwards: meritSummary.totalAwards,
          outstandingAmount: feeSummary.outstandingAmount, // Added to response
          paymentStatus: feeSummary.paymentStatus, // Added to response
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
  // router.post("/generate-student-report/:id", async (req, res) => {
  //   try {
  //     const { id } = req.params;

  //     if (!ObjectId.isValid(id)) {
  //       return res.status(400).json({
  //         success: false,
  //         error: "Invalid student ID format",
  //       });
  //     }

  //     // 1️⃣ Fetch student using shared aggregation pipeline
  //     const students = await studentsCollection
  //       .aggregate(buildStudentAggregationPipeline({ _id: new ObjectId(id) }))
  //       .toArray();

  //     if (!students.length) {
  //       return res.status(404).json({
  //         success: false,
  //         error: "Student not found",
  //       });
  //     }

  //     const studentData = students[0];
  //     const student_id = studentData._id.toString();

  //     // 2. Fetch attendance data
  //     const attendanceSummary = await attendancesCollection
  //       .aggregate([
  //         {
  //           $match: {
  //             student_id: student_id,
  //             attendance: "student",
  //           },
  //         },
  //         {
  //           $group: {
  //             _id: "$status",
  //             count: { $sum: 1 },
  //           },
  //         },
  //         {
  //           $group: {
  //             _id: null,
  //             total: { $sum: "$count" },
  //             statusCounts: {
  //               $push: {
  //                 k: "$_id",
  //                 v: "$count",
  //               },
  //             },
  //           },
  //         },
  //         {
  //           $project: {
  //             _id: 0,
  //             total: 1,
  //             statusCounts: {
  //               $arrayToObject: "$statusCounts",
  //             },
  //           },
  //         },
  //         {
  //           $project: {
  //             total: 1,
  //             present: { $ifNull: ["$statusCounts.present", 0] },
  //             absent: { $ifNull: ["$statusCounts.absent", 0] },
  //             late: { $ifNull: ["$statusCounts.late", 0] },
  //           },
  //         },
  //       ])
  //       .toArray();

  //     const attendanceData =
  //       attendanceSummary.length > 0
  //         ? attendanceSummary[0]
  //         : {
  //             total: 0,
  //             present: 0,
  //             absent: 0,
  //             late: 0,
  //           };

  //     // 3. Fetch merit data (SIMPLIFIED VERSION)
  //     const meritRecords = await meritsCollection
  //       .find({
  //         student_id: student_id,
  //       })
  //       .sort({ date: -1 })
  //       .limit(10)
  //       .toArray();

  //     // Calculate merit summary
  //     const totalMeritPoints = meritRecords.reduce(
  //       (sum, record) => sum + (record.merit_points || 0),
  //       0,
  //     );
  //     const totalAwards = meritRecords.length;
  //     const averagePoints =
  //       totalAwards > 0 ? totalMeritPoints / totalAwards : 0;

  //     // Calculate behavior breakdown
  //     const behaviorBreakdown = {};
  //     meritRecords.forEach((record) => {
  //       const behavior = record.behavior || "Other";
  //       if (!behaviorBreakdown[behavior]) {
  //         behaviorBreakdown[behavior] = {
  //           count: 0,
  //           totalPoints: 0,
  //           averagePoints: 0,
  //         };
  //       }
  //       behaviorBreakdown[behavior].count++;
  //       behaviorBreakdown[behavior].totalPoints += record.merit_points || 0;
  //       behaviorBreakdown[behavior].averagePoints =
  //         behaviorBreakdown[behavior].totalPoints /
  //         behaviorBreakdown[behavior].count;
  //     });

  //     const meritSummary = {
  //       totalMeritPoints,
  //       totalAwards,
  //       averagePoints,
  //       recentMerits: meritRecords.slice(0, 6), // Get first 6 (most recent)
  //       behaviorBreakdown,
  //     };

  //     // 4. Calculate years range (from joining year to current year)
  //     const currentYear = new Date().getFullYear();
  //     let startingYear = currentYear;

  //     if (studentData.startingDate) {
  //       const startDate = new Date(studentData.startingDate);
  //       startingYear = startDate.getFullYear();
  //     }

  //     // 5. Fetch lessons covered data for EACH YEAR using buildYearlySummaryPipeline
  //     const allYearsLessonsData = [];

  //     for (let year = startingYear; year <= currentYear; year++) {
  //       // Get yearly data using buildYearlySummaryPipeline
  //       const yearlyPipeline = buildYearlySummaryPipeline(year.toString());

  //       // Get ALL students data for this year
  //       const allYearlyData = await lessonsCoveredCollection
  //         .aggregate(yearlyPipeline)
  //         .toArray();

  //       // Filter to get ONLY this student's data
  //       const studentYearlyData = allYearlyData.filter((item) => {
  //         // Check if this is our student (student_id might be in different format)
  //         if (item.student_id && item.student_id.toString() === student_id) {
  //           return true;
  //         }
  //         // Also check student_name if student_id doesn't match
  //         if (item.student_name === studentData.name) {
  //           return true;
  //         }
  //         return false;
  //       });

  //       if (studentYearlyData.length > 0) {
  //         // Take the first matching record (should only be one per student per year)
  //         const yearData = {
  //           ...studentYearlyData[0],
  //           year: year.toString(),
  //         };
  //         allYearsLessonsData.push(yearData);
  //       } else {
  //         // Add empty year data if no records found
  //         allYearsLessonsData.push({
  //           year: year.toString(),
  //           progress: null,
  //           months_with_ending: 0,
  //           months_with_both: 0,
  //         });
  //       }
  //     }

  //     // 6. Generate PDF with comprehensive data INCLUDING MERIT DATA
  //     const pdfResult = await generateStudentReport(studentData, {
  //       attendance: attendanceData,
  //       lessons: allYearsLessonsData,
  //       merits: meritSummary, // Add merit data here
  //       startingYear: startingYear,
  //       currentYear: currentYear,
  //     });

  //     // 7. Upload to Cloudinary
  //     const cloudinaryUrl = await uploadToCloudinary(
  //       pdfResult.pdfBuffer,
  //       pdfResult.fileName,
  //     );

  //     // 8. Update student document
  //     await studentsCollection.updateOne(
  //       { _id: new ObjectId(id) },
  //       {
  //         $set: {
  //           reportPdf: cloudinaryUrl,
  //         },
  //       },
  //     );

  //     // 9. Return response
  //     res.status(200).json({
  //       success: true,
  //       message: `Comprehensive yearly report generated successfully (${startingYear}-${currentYear})`,
  //       reportUrl: cloudinaryUrl,
  //       reportId: pdfResult.reportId,
  //       studentId: id,
  //       studentName: studentData.name,
  //       yearsCovered: {
  //         from: startingYear,
  //         to: currentYear,
  //         totalYears: currentYear - startingYear + 1,
  //       },
  //       dataSummary: {
  //         attendanceRecords: attendanceData.total,
  //         yearsWithLessonsData: allYearsLessonsData.filter((d) => d.progress)
  //           .length,
  //         totalYearsCovered: allYearsLessonsData.length,
  //         totalMeritPoints: meritSummary.totalMeritPoints,
  //         totalMeritAwards: meritSummary.totalAwards,
  //       },
  //     });
  //   } catch (error) {
  //     console.error("Comprehensive report generation error:", error);
  //     res.status(500).json({
  //       success: false,
  //       error: "Failed to generate comprehensive report",
  //       details:
  //         process.env.NODE_ENV === "development" ? error.message : undefined,
  //     });
  //   }
  // });
  router.patch("/update-activity/:id", async (req, res) => {
    const studentId = req.params.id;
    if (!ObjectId.isValid(studentId)) {
      return res.status(400).send({ message: "Invalid student ID format" });
    }
    const query = { _id: new ObjectId(studentId) };
    const { activity } = req.body;
    const updatedDoc = {
      $set: { activity },
    };
    const result = await studentsCollection.updateOne(query, updatedDoc);
    res.send(result);
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

  return router;
};
