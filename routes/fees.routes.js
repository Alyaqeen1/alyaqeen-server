const express = require("express");
const { ObjectId } = require("mongodb");
const sendEmailViaAPI = require("../config/sendAdmissionEmail");
const sendHoldEmail = require("../config/sendHoldEmail");
const sendMonthlyFeeEmail = require("../config/sendMonthlyFeeEmail");
const router = express.Router();
const { addDays, isBefore, format, isValid } = require("date-fns");

const enrichStudents = async (
  feeStudents,
  studentsCollection,
  departmentsCollection,
  classesCollection
) => {
  // Get all student records
  const studentIds = feeStudents.map((s) => new ObjectId(s.studentId));
  const allStudents = await studentsCollection
    .find({ _id: { $in: studentIds }, activity: "active" })
    .toArray();

  // Get all referenced departments and classes
  const departmentIds = allStudents
    .map((s) => s.academic?.dept_id)
    .filter(Boolean)
    .map((id) => new ObjectId(id));

  const classIds = allStudents
    .map((s) => s.academic?.class_id)
    .filter(Boolean)
    .map((id) => new ObjectId(id));

  const [departments, classes] = await Promise.all([
    departmentsCollection.find({ _id: { $in: departmentIds } }).toArray(),
    classesCollection.find({ _id: { $in: classIds } }).toArray(),
  ]);

  // Create enriched students - PRESERVE FEE DATA
  return allStudents.map((student) => {
    const feeInfo = feeStudents.find(
      (s) => String(s.studentId) === String(student._id)
    );

    const department = departments.find(
      (d) => String(d._id) === String(student.academic?.dept_id)
    );

    const classInfo = classes.find(
      (c) => String(c._id) === String(student.academic?.class_id)
    );

    return {
      ...student,
      // ✅ PRESERVE ALL FEE DATA FROM ORIGINAL
      ...feeInfo,
      admissionFee: feeInfo?.admissionFee || 0,
      monthlyFee: feeInfo?.monthlyFee || 0,
      monthly_fee: feeInfo?.monthlyFee || 0,
      subtotal: feeInfo?.subtotal || 0,
      academic: {
        ...student.academic,
        department: department?.dept_name || "-",
        class: classInfo?.class_name || "-",
      },
    };
  });
};

module.exports = (
  feesCollection,
  studentsCollection,
  familiesCollection,
  departmentsCollection,
  classesCollection
) => {
  router.get("/", async (req, res) => {
    const result = await feesCollection.find().toArray();
    res.send(result);
  });
  // Get all fees that have payments, sorted by timestamp descending
  router.get("/with-payments", async (req, res) => {
    try {
      const result = await feesCollection
        .find({ payments: { $exists: true, $ne: [] } }) // only docs with non-empty payments
        .sort({ timestamp: -1 }) // sort by timestamp descending
        .toArray();

      res.send(result);
    } catch (err) {
      console.error("Error fetching fees with payments:", err);
      res.status(500).send({ message: "Internal server error" });
    }
  });

  router.get("/:id", async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await feesCollection.findOne(query);
    res.send(result);
  });
  router.post("/", async (req, res) => {
    const feesData = req.body;
    const {
      familyId,
      amount,
      paymentType,
      students = [],
      method = "Unknown",
    } = feesData;

    try {
      console.log("📨 Starting fee creation process...");

      // 1. Get the family document
      const family = await familiesCollection.findOne({
        _id: new ObjectId(familyId),
      });

      if (!family || !Array.isArray(family.children)) {
        return res
          .status(404)
          .send({ message: "Family not found or has no children." });
      }

      const familyName = family?.name || "Parent";
      const familyEmail = family?.email;

      if (!familyEmail) {
        return res.status(400).send({ message: "Family email is required." });
      }

      // 2. Extract studentIds from students
      const studentIds = students?.map((s) => new ObjectId(s.studentId));

      // 3. Fetch full student records
      const allStudents = await studentsCollection
        .find({ _id: { $in: studentIds } })
        .toArray();

      if (!allStudents.length) {
        return res
          .status(404)
          .send({ message: "No matching students found in the database." });
      }

      // 4. Optionally add timestamp
      feesData.timestamp = new Date();

      // 5. Save fee document
      const result = await feesCollection.insertOne(feesData);

      // ✅ FIXED: Calculate actual values from payments array
      const paidAmount =
        feesData.payments?.reduce(
          (sum, payment) => sum + (payment.amount || 0),
          0
        ) || 0;
      const paymentMethod = feesData.payments?.[0]?.method || method;
      const paymentDate =
        feesData.payments?.[0]?.date || new Date().toISOString().slice(0, 10);
      const remainingAmount = feesData.remaining || 0;

      // ✅ FIXED: Monthly email with correct data
      // 5. Send Monthly Email with month info
      if (paymentType === "monthly" || paymentType === "monthlyOnHold") {
        try {
          // Prepare students data for email
          const studentsForEmail = feesData.students.map((s) => ({
            name: s.name,
            monthsPaid: (s.monthsPaid || []).map((m) => ({
              month: m.month,
              year: m.year,
              monthlyFee: m.monthlyFee,
              discountedFee: m.discountedFee,
              paid: m.paid,
            })),
            subtotal: s.subtotal,
          }));

          await sendMonthlyFeeEmail({
            to: familyEmail,
            parentName: familyName,
            students: studentsForEmail,
            totalAmount: paidAmount,
            method: paymentMethod,
            paymentDate: paymentDate,
            isOnHold: paymentType === "monthlyOnHold",
            remainingAmount: remainingAmount,
          });

          console.log("✅ Monthly fee email sent successfully");
        } catch (emailError) {
          console.error("❌ Monthly fee email failed:", emailError);
        }
      }

      // 6. Send Email based on type
      if (paymentType === "admissionOnHold") {
        console.log("📧 Sending admission on hold email...");
        try {
          await sendHoldEmail({
            to: familyEmail,
            parentName: familyName,
            studentNames: allStudents.map((s) => s.name),
            method: paymentMethod,
          });
          console.log("✅ Hold email sent successfully");
        } catch (emailError) {
          console.error("❌ Hold email failed:", emailError);
        }
      } else if (paymentType === "admission") {
        console.log("📧 Processing admission email...");
        try {
          const enrichedStudents = await enrichStudents(
            feesData.students,
            studentsCollection,
            departmentsCollection,
            classesCollection
          );

          // ✅ FIXED: Ensure we have the fee data from original students
          const studentBreakdown = enrichedStudents.map((enrichedStudent) => {
            // Find the original fee data for this student
            const originalStudent = feesData.students.find(
              (s) => String(s.studentId) === String(enrichedStudent._id)
            );

            const admissionFee = originalStudent?.admissionFee || 20;
            const monthlyFee = originalStudent?.monthlyFee || 50;
            const totalPaid = originalStudent?.subtotal || 0;

            // Calculate how much was paid for admission vs monthly
            const admissionPaid = Math.min(totalPaid, admissionFee);
            const monthlyPaid = Math.max(0, totalPaid - admissionFee);
            const admissionRemaining = Math.max(
              0,
              admissionFee - admissionPaid
            );
            const monthlyRemaining = Math.max(0, monthlyFee - monthlyPaid);
            const studentRemaining = admissionRemaining + monthlyRemaining;

            return {
              ...enrichedStudent, // Academic info
              admissionFee, // From original fee data
              monthlyFee, // From original fee data
              subtotal: totalPaid, // From original fee data
              admissionPaid,
              monthlyPaid,
              admissionRemaining,
              monthlyRemaining,
              studentRemaining,
            };
          });

          console.log("📧 Sending admission email...");
          await sendEmailViaAPI({
            to: familyEmail,
            parentName: familyName,
            students: studentBreakdown,
            totalAmount: paidAmount,
            method: paymentMethod,
            paymentDate: paymentDate,
            remainingAmount: remainingAmount,
            studentBreakdown: studentBreakdown,
          });
          console.log("✅ Admission email sent successfully");
        } catch (admissionError) {
          console.error("❌ Admission email process failed:", admissionError);
          // Don't fail the request if email fails
        }
      } else {
        console.log("ℹ️ No email sent for payment type:", paymentType);
      }

      console.log("🎉 Fee creation process completed successfully");
      res.send(result);
    } catch (err) {
      console.error("💥 CRITICAL ERROR in fee creation:", err);
      res.status(500).send({
        message: "Internal server error",
        error: err.message,
      });
    }
  });

  router.get("/student-summary/:studentId", async (req, res) => {
    try {
      const { studentId } = req.params;

      if (!studentId) {
        return res.status(400).send({ message: "Student ID is required" });
      }

      // 1. Get the student details
      const student = await studentsCollection.findOne({
        _id: new ObjectId(studentId),
      });

      if (!student) {
        return res.status(404).send({ message: "Student not found" });
      }

      // 2. Get ALL fees for this student
      const allFees = await feesCollection
        .find({
          "students.studentId": studentId,
          paymentType: {
            $in: ["monthly", "monthlyOnHold", "admission", "admissionOnHold"],
          },
        })
        .toArray();

      // 3. Extract all paid months and calculate payments correctly
      const paidMonths = new Set();
      let totalMonthlyPaid = 0;
      const monthlyPayments = [];
      const allStudentPayments = [];

      allFees.forEach((fee) => {
        const feeStudent = fee.students.find((s) => s.studentId === studentId);
        if (!feeStudent) return;

        // Helper function to get payment date for a specific student in a fee
        // Helper function to get payment date for a specific student in a fee
        const getPaymentDate = (fee, feeStudent) => {
          // 1. NEW SYSTEM: Student-level payments
          if (
            Array.isArray(feeStudent?.payments) &&
            feeStudent.payments.length > 0
          ) {
            const sorted = feeStudent.payments
              .filter((p) => p.date)
              .sort((a, b) => new Date(a.date) - new Date(b.date));
            if (sorted.length > 0) return sorted[0].date;
          }

          // 2. NEW SYSTEM: Fee-level payments
          if (Array.isArray(fee?.payments) && fee.payments.length > 0) {
            const sorted = fee.payments
              .filter((p) => p.date)
              .sort((a, b) => new Date(a.date) - new Date(b.date));
            if (sorted.length > 0) return sorted[0].date;
          }

          // 3. OLD SYSTEM: fee.date (if it exists explicitly)
          if (fee.date) {
            return fee.date;
          }

          // ❌ REMOVE timestamp-to-date conversion
          // Old LMS "timestamp" is just document creation, not payment date

          // 4. Old LMS: no real date available
          return "N/A";
        };

        const paymentDate = getPaymentDate(fee, feeStudent);

        // Handle monthly fees
        if (
          fee.paymentType === "monthly" ||
          fee.paymentType === "monthlyOnHold"
        ) {
          if (feeStudent.monthsPaid) {
            feeStudent.monthsPaid.forEach((monthPaid) => {
              const monthKey = `${monthPaid.year}-${monthPaid.month
                .toString()
                .padStart(2, "0")}`;

              // Only process if not already processed (avoid duplicates)
              if (!paidMonths.has(monthKey)) {
                paidMonths.add(monthKey);

                const paymentAmount =
                  monthPaid.paid ||
                  monthPaid.discountedFee ||
                  monthPaid.monthlyFee ||
                  0;
                totalMonthlyPaid += paymentAmount;

                monthlyPayments.push({
                  month: monthKey,
                  displayMonth: formatDisplayMonth(monthKey),
                  amount: paymentAmount,
                  paymentDate: paymentDate, // This will be "N/A" for old data, actual date for new data
                  status: fee.status,
                  paymentType: fee.paymentType,
                  feeId: fee._id,
                  isFirstMonth: false,
                });
              }
            });
          }
        }

        // Handle admission fees
        if (
          fee.paymentType === "admission" ||
          fee.paymentType === "admissionOnHold"
        ) {
          // Extract first month payment from admission fee
          if (feeStudent.joiningMonth && feeStudent.joiningYear) {
            const monthKey = `${
              feeStudent.joiningYear
            }-${feeStudent.joiningMonth.toString().padStart(2, "0")}`;

            // Calculate how much was actually paid for the first month
            let firstMonthPaid = 0;

            // For NEW SYSTEM: If there are individual payments array, sum them up
            if (feeStudent.payments && Array.isArray(feeStudent.payments)) {
              firstMonthPaid = feeStudent.payments.reduce(
                (sum, payment) => sum + (payment.amount || 0),
                0
              );
            } else {
              // For OLD SYSTEM: Fallback to subtotal or monthly fee
              firstMonthPaid =
                feeStudent.subtotal || feeStudent.monthlyFee || 0;
            }

            // Only consider the monthly fee portion (not admission fee)
            if (
              fee.status === "paid" &&
              firstMonthPaid >= (feeStudent.monthlyFee || 0)
            ) {
              if (!paidMonths.has(monthKey)) {
                paidMonths.add(monthKey);
                totalMonthlyPaid += feeStudent.monthlyFee || 0;

                monthlyPayments.push({
                  month: monthKey,
                  displayMonth: formatDisplayMonth(monthKey),
                  amount: feeStudent.monthlyFee || 0,
                  paymentDate: paymentDate, // This will be "N/A" for old data, actual date for new data
                  status: fee.status,
                  paymentType: fee.paymentType,
                  feeId: fee._id,
                  isFirstMonth: true,
                });
              }
            } else if (fee.status === "partial") {
              // For partial payments, we need to determine how much of the monthly fee was paid
              const monthlyFee = feeStudent.monthlyFee || 0;
              const admissionFee = feeStudent.admissionFee || 0;
              const totalExpected = monthlyFee + admissionFee;
              const totalPaid = firstMonthPaid;

              // If paid amount covers admission fee + some monthly fee
              if (totalPaid > admissionFee) {
                const monthlyPortionPaid = totalPaid - admissionFee;
                if (!paidMonths.has(monthKey)) {
                  paidMonths.add(monthKey);
                  totalMonthlyPaid += monthlyPortionPaid;

                  monthlyPayments.push({
                    month: monthKey,
                    displayMonth: formatDisplayMonth(monthKey),
                    amount: monthlyPortionPaid,
                    paymentDate: paymentDate, // This will be "N/A" for old data, actual date for new data
                    status: "partial",
                    paymentType: fee.paymentType,
                    feeId: fee._id,
                    isFirstMonth: true,
                    note: `Partial payment (${monthlyPortionPaid} of ${monthlyFee})`,
                  });
                }
              }
            }
          }
        }

        // Track all payments for this student
        allStudentPayments.push({
          _id: fee._id,
          amount: feeStudent.subtotal || 0,
          status: fee.status,
          paymentType: fee.paymentType,
          timestamp: paymentDate, // This will be "N/A" for old data, actual date for new data
          studentPortion: feeStudent.subtotal || 0,
        });
      });

      // 4. Calculate unpaid months
      const monthlyOnlyFees = allFees.filter(
        (fee) =>
          fee.paymentType === "monthly" || fee.paymentType === "monthlyOnHold"
      );

      const unpaidFees = getUnpaidFees({
        students: [student],
        fees: monthlyOnlyFees,
        feeChoice: "standard",
        discount: 0,
      });

      // 5. Calculate outstanding amount and unpaid months details
      let outstandingAmount = 0;
      const unpaidMonthsDetails = [];
      const september2025 = new Date("2025-09-01");

      unpaidFees.forEach((unpaidFee) => {
        unpaidFee.students.forEach((unpaidStudent) => {
          if (unpaidStudent.studentId === studentId) {
            unpaidStudent.monthsUnpaid.forEach((monthUnpaid) => {
              const monthDate = new Date(`${monthUnpaid.month}-01`);
              if (monthDate >= september2025) {
                // Check if this month was partially paid
                const monthKey = monthUnpaid.month;
                const paidMonth = monthlyPayments.find(
                  (p) => p.month === monthKey
                );

                if (paidMonth && paidMonth.status === "partial") {
                  // Calculate remaining amount for partially paid month
                  const remaining =
                    monthUnpaid.discountedFee - paidMonth.amount;
                  if (remaining > 0) {
                    outstandingAmount += remaining;

                    unpaidMonthsDetails.push({
                      month: monthUnpaid.month,
                      displayMonth: formatDisplayMonth(monthUnpaid.month),
                      monthlyFee: monthUnpaid.monthlyFee,
                      discountedFee: monthUnpaid.discountedFee,
                      paidAmount: paidMonth.amount,
                      remainingAmount: remaining,
                      status: "partial",
                    });
                  }
                } else if (!paidMonths.has(monthKey)) {
                  // Fully unpaid month
                  outstandingAmount += monthUnpaid.discountedFee;

                  unpaidMonthsDetails.push({
                    month: monthUnpaid.month,
                    displayMonth: formatDisplayMonth(monthUnpaid.month),
                    monthlyFee: monthUnpaid.monthlyFee,
                    discountedFee: monthUnpaid.discountedFee,
                    paidAmount: 0,
                    remainingAmount: monthUnpaid.discountedFee,
                    status: "unpaid",
                  });
                }
              }
            });
          }
        });
      });

      // 6. Get the last paid month
      const sortedPayments = monthlyPayments.sort(
        (a, b) => new Date(b.month) - new Date(a.month)
      );
      const lastPaidMonth =
        sortedPayments.length > 0 ? sortedPayments[0].month : null;

      // 7. Count consecutive unpaid months from last paid month
      let consecutiveUnpaidMonths = 0;
      if (lastPaidMonth) {
        const lastPaidDate = new Date(`${lastPaidMonth}-01`);
        const currentDate = new Date();

        let currentMonth = new Date(lastPaidDate);
        currentMonth.setMonth(currentMonth.getMonth() + 1);

        while (currentMonth <= currentDate) {
          const monthKey = format(currentMonth, "yyyy-MM");
          const monthDate = new Date(monthKey + "-01");

          if (monthDate >= september2025) {
            const paidMonth = monthlyPayments.find((p) => p.month === monthKey);
            if (!paidMonth || paidMonth.status === "partial") {
              consecutiveUnpaidMonths++;
            } else {
              break;
            }
          }
          currentMonth.setMonth(currentMonth.getMonth() + 1);
        }
      }

      // 8. Sort all payments by date (handle "N/A" dates by putting them at the end)
      const formattedAllPayments = allStudentPayments
        .sort((a, b) => {
          if (a.timestamp === "N/A" && b.timestamp === "N/A") return 0;
          if (a.timestamp === "N/A") return 1; // Put N/A dates at the end
          if (b.timestamp === "N/A") return -1; // Put actual dates first
          return new Date(b.timestamp) - new Date(a.timestamp);
        })
        .map((payment) => ({
          _id: payment._id,
          amount: payment.amount,
          status: payment.status,
          paymentType: payment.paymentType,
          timestamp: payment.timestamp,
          studentPortion: payment.studentPortion,
        }));

      // 9. Prepare the response
      const result = {
        student: {
          _id: student._id,
          name: student.name,
          monthly_fee: student.monthly_fee || 0,
          startingDate: student.startingDate,
        },
        summary: {
          totalMonthlyPaid: parseFloat(totalMonthlyPaid.toFixed(2)),
          outstandingAmount: parseFloat(outstandingAmount.toFixed(2)),
          totalMonthsPaid: paidMonths.size,
          totalMonthsUnpaid: unpaidMonthsDetails.length,
          consecutiveUnpaidMonths,
          lastPaidMonth: lastPaidMonth
            ? formatDisplayMonth(lastPaidMonth)
            : null,
        },
        paidMonths: monthlyPayments
          .sort((a, b) => new Date(b.month) - new Date(a.month))
          .map((payment) => ({
            month: payment.displayMonth,
            amount: payment.amount,
            paymentDate: payment.paymentDate, // Will show actual date for new data, "N/A" for old data
            status: payment.status,
            paymentType: payment.paymentType,
            feeId: payment.feeId,
            isFirstMonth: payment.isFirstMonth || false,
            note: payment.note || null,
          })),
        unpaidMonths: unpaidMonthsDetails
          .sort((a, b) => new Date(b.month) - new Date(a.month))
          .map((unpaid) => ({
            month: unpaid.displayMonth,
            monthlyFee: unpaid.monthlyFee,
            discountedFee: unpaid.discountedFee,
            paidAmount: unpaid.paidAmount || 0,
            remainingAmount: unpaid.remainingAmount,
            status: unpaid.status,
          })),
        allPayments: formattedAllPayments,
      };

      res.send(result);
    } catch (error) {
      console.error("Error in student fee summary:", error);
      res.status(500).send({ message: "Internal server error" });
    }
  });

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

  // You'll also need to include the getUnpaidFees function in this file
  function getUnpaidFees({
    students,
    fees,
    feeChoice,
    discount = 0,
    startFromMonth,
  }) {
    const [startYear, startMonth] = startFromMonth
      ? startFromMonth.split("-").map(Number)
      : [0, 0];

    const monthlyPaidMap = {};

    // Build payment map from fee records (same as before)
    for (const fee of fees || []) {
      if (
        (fee.paymentType === "monthly" ||
          fee.paymentType === "monthlyOnHold") &&
        (fee.status === "paid" || fee.status === "pending")
      ) {
        for (const stu of fee.students || []) {
          const studentId = stu?.studentId?.toString?.();
          if (Array.isArray(stu.monthsPaid)) {
            for (const { month, year } of stu.monthsPaid) {
              const monthStr = `${year}-${month.toString().padStart(2, "0")}`;
              monthlyPaidMap[`${studentId}_${monthStr}`] = true;
            }
          }
        }
      }
    }

    const grouped = {};

    for (const student of students) {
      const studentId = student._id?.toString?.();
      const { name, monthly_fee, startingDate } = student;

      const fee = monthly_fee || 0;

      const addUnpaidMonth = (monthStr, year, month) => {
        if (year < startYear || (year === startYear && month < startMonth))
          return; // skip months before startFromMonth
        const key = `${studentId}_${monthStr}`;
        if (monthlyPaidMap[key]) return;

        const discountedFee = fee - (fee * discount) / 100;

        if (!grouped[monthStr]) {
          grouped[monthStr] = {
            totalAmount: 0,
            studentNames: new Set(),
            studentsMap: {},
          };
        }

        grouped[monthStr].totalAmount += discountedFee;
        grouped[monthStr].studentNames.add(name);

        if (!grouped[monthStr].studentsMap[studentId]) {
          grouped[monthStr].studentsMap[studentId] = {
            studentId,
            name,
            subtotal: 0,
            monthsUnpaid: [],
          };
        }

        grouped[monthStr].studentsMap[studentId].monthsUnpaid.push({
          month: monthStr,
          monthlyFee: fee,
          discountedFee: parseFloat(discountedFee.toFixed(2)),
        });

        grouped[monthStr].studentsMap[studentId].subtotal += discountedFee;
      };

      // calculate months (same as your current logic)
      let currentDate = new Date();
      let payableMonth = new Date(startingDate);
      payableMonth.setDate(1);

      while (payableMonth <= currentDate) {
        const year = payableMonth.getFullYear();
        const month = payableMonth.getMonth() + 1;
        const monthStr = `${year}-${month.toString().padStart(2, "0")}`;
        addUnpaidMonth(monthStr, year, month);
        payableMonth.setMonth(payableMonth.getMonth() + 1);
      }
    }

    return Object.entries(grouped).map(([month, data]) => ({
      month,
      totalAmount: parseFloat(data.totalAmount.toFixed(2)),
      studentNames: Array.from(data.studentNames).join(", "),
      students: Object.values(data.studentsMap).map((stu) => ({
        ...stu,
        subtotal: parseFloat(stu.subtotal.toFixed(2)),
      })),
    }));
  }

  router.get("/by-status/:status", async (req, res) => {
    const status = req.params.status;
    const query = { status };
    const result = await feesCollection.find(query).toArray();
    res.send(result);
  });

  router.get("/by-id/:id", async (req, res) => {
    const id = req.params.id;
    const query = { familyId: id };
    const result = await feesCollection.find(query).toArray();
    res.send(result);
  });
  router.get("/by-fee-id/:id", async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await feesCollection.findOne(query);
    res.send(result);
  });

  router.patch("/update-status-mode/:id", async (req, res) => {
    const { id } = req.params;
    const { status, paymentType } = req.body;

    if (!id || !status) {
      return res
        .status(400)
        .json({ error: "Missing required fields (id or status)" });
    }

    try {
      // 1. Get the fee document
      const fee = await feesCollection.findOne({ _id: new ObjectId(id) });
      if (!fee) return res.status(404).json({ error: "Fee not found" });

      // 2. Get family data
      const family = await familiesCollection.findOne({
        _id: new ObjectId(fee.familyId),
      });
      if (!family) return res.status(404).json({ error: "Family not found" });

      // 3. Get full student records (same as POST route)
      const studentIds = fee.students.map((s) => new ObjectId(s.studentId));
      const allStudents = await studentsCollection
        .find({
          _id: { $in: studentIds },
        })
        .toArray();

      // 4. Simple update
      const result = await feesCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status, paymentType } }
      );

      // 5. Send appropriate email (now with enriched students like POST route)
      if (result.modifiedCount > 0 && status === "paid") {
        // Create enriched students array (same as POST route)
        const enrichedStudents = await enrichStudents(
          fee.students,
          studentsCollection,
          departmentsCollection,
          classesCollection
        );

        if (fee.paymentType === "admissionOnHold") {
          await sendEmailViaAPI({
            to: family.email,
            parentName: family.name,
            students: enrichedStudents, // Now using enriched data
            totalAmount: fee.amount,
            method: fee.method,
          });
        } else if (fee.paymentType === "monthlyOnHold") {
          await sendMonthlyFeeEmail({
            to: family.email,
            parentName: family.name,
            students: enrichedStudents, // Now using enriched data
            totalAmount: fee.amount,
            method: fee.method,
            date: fee.date || new Date(),
            isOnHold: false,
          });
        }
      }

      res.send(result);
    } catch (err) {
      res.status(500).json({ error: "Server error" });
    }
  });

  // Update fee (partial payment for both monthly and admission)
  router.patch("/update/:id", async (req, res) => {
    const { id } = req.params;
    const {
      partialAmount,
      partialMethod,
      partialDate,
      studentIds,
      month,
      year,
    } = req.body;

    console.log("📥 Received payment:", {
      month,
      year,
      partialAmount,
      studentIds,
      monthType: typeof month,
      yearType: typeof year,
    });

    try {
      const fee = await feesCollection.findOne({ _id: new ObjectId(id) });
      if (!fee) return res.status(404).send({ message: "Fee not found" });

      // Get family for email
      const family = await familiesCollection.findOne({
        _id: new ObjectId(fee.familyId),
      });

      // ✅ Add new payment record to root payments array
      const newPayment = {
        amount: Number(partialAmount),
        method: partialMethod || "Unknown",
        date: partialDate || new Date().toISOString().slice(0, 10),
      };

      // ✅ NORMALIZE MONTH/YEAR: Ensure consistent format
      const normalizedMonth = String(month).padStart(2, "0");
      const normalizedYear = Number(year);

      console.log("🎯 Normalized:", {
        originalMonth: month,
        normalizedMonth,
        originalYear: year,
        normalizedYear,
      });

      // ✅ Update students based on payment type
      const students = fee.students.map((s) => {
        if (studentIds.includes(String(s.studentId))) {
          if (
            fee.paymentType === "monthly" ||
            fee.paymentType === "monthlyOnHold"
          ) {
            // ✅ FIXED: Proper month comparison with logging
            if (!s.monthsPaid) s.monthsPaid = [];

            console.log(
              "🔍 Searching for month in:",
              s.monthsPaid.map((m) => ({
                month: m.month,
                year: m.year,
                type: typeof m.month,
              }))
            );

            let monthEntry = s.monthsPaid.find(
              (m) =>
                String(m.month).padStart(2, "0") === normalizedMonth &&
                Number(m.year) === normalizedYear
            );

            console.log("📋 Month entry found:", monthEntry);

            if (monthEntry) {
              // ✅ UPDATE existing month entry
              const oldPaid = monthEntry.paid || 0;
              monthEntry.paid =
                oldPaid + Number(partialAmount) / studentIds.length;
              console.log(
                `💰 Updated month ${normalizedMonth}/${normalizedYear}: ${oldPaid} → ${monthEntry.paid}`
              );
            } else {
              // ✅ CREATE new month entry (only if it doesn't exist)
              const baseFee = s.monthlyFee || s.monthly_fee || 50;
              const discountPercent = family?.discount
                ? Number(family.discount)
                : 0;
              const discountedFee =
                discountPercent > 0
                  ? Number(
                      (baseFee - (baseFee * discountPercent) / 100).toFixed(2)
                    )
                  : Number(baseFee);

              const newMonthEntry = {
                month: normalizedMonth,
                year: normalizedYear,
                monthlyFee: Number(baseFee),
                discountedFee: discountedFee,
                paid: Number(partialAmount) / studentIds.length,
              };

              s.monthsPaid.push(newMonthEntry);
              console.log(`🆕 Created new month entry:`, newMonthEntry);
            }

            // Recalc subtotal for monthly
            s.subtotal = s.monthsPaid.reduce(
              (sum, m) => sum + (m.paid || 0),
              0
            );
          } else if (
            fee.paymentType === "admission" ||
            fee.paymentType === "admissionOnHold"
          ) {
            // Handle admission payments - FIXED for your data structure
            const admissionFee = s.admissionFee || 20;
            const baseMonthlyFee = s.monthlyFee || s.monthly_fee || 50;
            const discountedMonthlyFee =
              discountPercent > 0
                ? Number(
                    (
                      baseMonthlyFee -
                      (baseMonthlyFee * discountPercent) / 100
                    ).toFixed(2)
                  )
                : Number(baseMonthlyFee);

            // Calculate amount per student
            const amountPerStudent = Number(partialAmount) / studentIds.length;

            // For admission fees, we need to update the payments array within the student
            if (!s.payments) s.payments = [];

            // Find if there's an existing payment for today
            const today = partialDate || new Date().toISOString().slice(0, 10);
            const existingPaymentIndex = s.payments.findIndex(
              (p) => p.date === today
            );

            if (existingPaymentIndex !== -1) {
              // Update existing payment
              s.payments[existingPaymentIndex].amount =
                Number(s.payments[existingPaymentIndex].amount || 0) +
                amountPerStudent;
            } else {
              // Add new payment - but we need to determine if it's admission or monthly portion
              // Since admission is already paid first, any additional payment goes to monthly portion
              const currentAdmissionPaid =
                s.payments.filter((p) => p.amount === admissionFee).length > 0
                  ? admissionFee
                  : 0;
              const currentMonthlyPaid = s.subtotal - currentAdmissionPaid;

              // If admission not fully paid, pay admission first
              if (currentAdmissionPaid < admissionFee) {
                const admissionNeeded = admissionFee - currentAdmissionPaid;
                const admissionPayment = Math.min(
                  amountPerStudent,
                  admissionNeeded
                );
                const monthlyPayment = amountPerStudent - admissionPayment;

                if (admissionPayment > 0) {
                  s.payments.push({
                    amount: Number(admissionPayment),
                    date: today,
                    method: partialMethod || "Unknown",
                  });
                }

                if (monthlyPayment > 0) {
                  s.payments.push({
                    amount: Number(monthlyPayment),
                    date: today,
                    method: partialMethod || "Unknown",
                  });
                }
              } else {
                // Admission already paid, all goes to monthly
                s.payments.push({
                  amount: Number(amountPerStudent),
                  date: today,
                  method: partialMethod || "Unknown",
                });
              }
            }

            // Recalc subtotal from payments array
            s.subtotal = s.payments.reduce(
              (sum, p) => sum + (p.amount || 0),
              0
            );
          }
        }
        return s;
      });

      // ✅ Recalculate totals
      const totalPaid = students.reduce((sum, s) => sum + (s.subtotal || 0), 0);
      const remaining = Math.max(0, (fee.expectedTotal || 0) - totalPaid);
      const newStatus =
        remaining <= 0 ? "paid" : totalPaid > 0 ? "partial" : "unpaid";

      // ✅ Update root payments array (add the new payment)
      const updatedRootPayments = [...(fee.payments || []), newPayment];

      // ✅ Update in DB
      const updatedFee = await feesCollection.findOneAndUpdate(
        { _id: new ObjectId(id) },
        {
          $set: {
            students,
            remaining: Number(remaining.toFixed(2)),
            status: newStatus,
            payments: updatedRootPayments,
          },
        },
        { returnDocument: "after" }
      );

      // ✅ SEND EMAIL FOR PARTIAL PAYMENT
      if (family && family.email) {
        try {
          console.log("📧 Sending partial payment email...");

          const paymentMethod =
            partialMethod || updatedFee.payments?.[0]?.method || "Unknown";
          const paymentDate =
            partialDate || new Date().toISOString().slice(0, 10);

          if (
            fee.paymentType === "monthly" ||
            fee.paymentType === "monthlyOnHold"
          ) {
            console.log("🔍 Final payment details for email:", {
              partialAmount,
              normalizedMonth,
              normalizedYear,
              paymentType: fee.paymentType,
            });

            // Prepare students data for email - include ALL months for each student
            const studentsForEmail = updatedFee.students.map((student) => ({
              name: student.name,
              monthsPaid: student.monthsPaid || [],
              subtotal: student.subtotal,
            }));

            await sendMonthlyFeeEmail({
              to: family.email,
              parentName: family.name || "Parent",
              students: studentsForEmail,
              totalAmount: Number(partialAmount),
              method: paymentMethod,
              paymentDate: paymentDate,
              isOnHold: fee.paymentType === "monthlyOnHold",
              remainingAmount: remaining,
              isPartialPayment: true,
            });

            console.log(
              `✅ Partial payment email sent for ${normalizedMonth}/${normalizedYear}`
            );
          } else if (
            fee.paymentType === "admission" ||
            fee.paymentType === "admissionOnHold"
          ) {
            const enrichedStudents = await enrichStudents(
              updatedFee.students,
              studentsCollection,
              departmentsCollection,
              classesCollection
            );

            const studentBreakdown = enrichedStudents.map((enrichedStudent) => {
              const originalStudent = updatedFee.students.find(
                (s) => String(s.studentId) === String(enrichedStudent._id)
              );

              const admissionFee = originalStudent?.admissionFee || 20;
              const monthlyFee = originalStudent?.monthlyFee || 50;
              const totalPaid = originalStudent?.subtotal || 0;

              const admissionPaid = Math.min(totalPaid, admissionFee);
              const monthlyPaid = Math.max(0, totalPaid - admissionFee);
              const admissionRemaining = Math.max(
                0,
                admissionFee - admissionPaid
              );
              const monthlyRemaining = Math.max(0, monthlyFee - monthlyPaid);
              const studentRemaining = admissionRemaining + monthlyRemaining;

              return {
                ...enrichedStudent,
                admissionFee,
                monthlyFee,
                subtotal: totalPaid,
                admissionPaid,
                monthlyPaid,
                admissionRemaining,
                monthlyRemaining,
                studentRemaining,
              };
            });

            await sendEmailViaAPI({
              to: family.email,
              parentName: family.name || "Parent",
              students: studentBreakdown,
              totalAmount: Number(partialAmount),
              method: paymentMethod,
              paymentDate: paymentDate,
              remainingAmount: remaining,
              studentBreakdown: studentBreakdown,
              isPartialPayment: true,
            });
          }
        } catch (emailError) {
          console.error("❌ Partial payment email failed:", emailError);
        }
      }

      res.send({
        message: "Partial payment added",
        updatedFee,
        emailSent: !!family?.email,
        appliedMonth: normalizedMonth,
        appliedYear: normalizedYear,
      });
    } catch (err) {
      console.error("Update fee error:", err);
      res.status(500).send({ message: "Internal server error" });
    }
  });
  // PATCH /partial-payment/:id
  router.patch("/update-payment/:id", async (req, res) => {
    const { id } = req.params;
    const { payments } = req.body;

    if (!payments || !Array.isArray(payments) || payments.length === 0) {
      return res.status(400).send({ message: "Payments array is required" });
    }

    try {
      const fee = await feesCollection.findOne({ _id: new ObjectId(id) });
      if (!fee) return res.status(404).send({ message: "Fee not found" });

      // Get family for discount calculation
      const family = await familiesCollection.findOne({
        _id: new ObjectId(fee.familyId),
      });
      const discountPercent = family?.discount ? Number(family.discount) : 0;

      const students = fee.students.map((s) => {
        const studentPayments = payments.filter(
          (p) => String(p.studentId) === String(s.studentId)
        );

        if (
          fee.paymentType === "monthly" ||
          fee.paymentType === "monthlyOnHold"
        ) {
          // Handle monthly payments - UPDATE existing amounts
          studentPayments.forEach((p) => {
            let monthEntry = s.monthsPaid?.find(
              (m) =>
                String(m.month) === String(p.month) &&
                String(m.year) === String(p.year)
            );

            if (monthEntry) {
              // UPDATE the existing payment amount
              monthEntry.paid = Number(p.amount);

              // Ensure discounted fee is calculated correctly
              const baseFee = monthEntry.monthlyFee || s.monthlyFee || 50;
              if (discountPercent > 0) {
                monthEntry.discountedFee = Number(
                  (baseFee - (baseFee * discountPercent) / 100).toFixed(2)
                );
              } else {
                monthEntry.discountedFee = Number(baseFee);
              }
            } else {
              // Create new month entry if it doesn't exist
              if (!s.monthsPaid) s.monthsPaid = [];

              const baseFee = s.monthlyFee || 50;
              const discountedFee =
                discountPercent > 0
                  ? Number(
                      (baseFee - (baseFee * discountPercent) / 100).toFixed(2)
                    )
                  : Number(baseFee);

              s.monthsPaid.push({
                month: p.month,
                year: p.year,
                monthlyFee: baseFee,
                discountedFee: discountedFee,
                paid: Number(p.amount),
              });
            }
          });

          // Recalculate subtotal from monthsPaid
          s.subtotal =
            s.monthsPaid?.reduce((sum, m) => sum + (m.paid || 0), 0) || 0;
        } else if (
          fee.paymentType === "admission" ||
          fee.paymentType === "admissionOnHold"
        ) {
          // Handle admission payments - UPDATE amounts
          const admissionFee = s.admissionFee || 20;
          const baseMonthlyFee = s.monthlyFee || s.monthly_fee || 50;
          const discountedMonthlyFee =
            discountPercent > 0
              ? Number(
                  (
                    baseMonthlyFee -
                    (baseMonthlyFee * discountPercent) / 100
                  ).toFixed(2)
                )
              : Number(baseMonthlyFee);

          // Calculate total payment for this student
          const totalPaid = studentPayments.reduce(
            (sum, p) => sum + Number(p.amount),
            0
          );

          // UPDATE the payments array
          s.payments = [];

          // Add admission payment (always £20 first)
          const admissionPayment = Math.min(totalPaid, admissionFee);
          if (admissionPayment > 0) {
            s.payments.push({
              amount: Number(admissionPayment),
              date:
                fee.payments?.[0]?.date ||
                new Date().toISOString().slice(0, 10),
              method: fee.payments?.[0]?.method || "Unknown",
            });
          }

          // Add monthly portion with remaining amount
          const monthlyPayment = Math.max(0, totalPaid - admissionPayment);
          if (monthlyPayment > 0) {
            s.payments.push({
              amount: Number(monthlyPayment),
              date:
                fee.payments?.[0]?.date ||
                new Date().toISOString().slice(0, 10),
              method: fee.payments?.[0]?.method || "Unknown",
            });
          }

          // Update subtotal (sum of all payments)
          s.subtotal = s.payments.reduce(
            (sum, payment) => sum + (payment.amount || 0),
            0
          );
          s.discountedFee = discountedMonthlyFee;
        }

        return s;
      });

      // Recalculate totals for fee
      const totalPaid = students.reduce((sum, s) => sum + (s.subtotal || 0), 0);
      const remaining = Math.max(0, (fee.expectedTotal || 0) - totalPaid);
      const newStatus =
        remaining <= 0 ? "paid" : totalPaid > 0 ? "partial" : "unpaid";

      // UPDATE root payments array with new total amount
      const totalPaymentAmount = payments.reduce(
        (sum, p) => sum + Number(p.amount),
        0
      );
      const updatedPayments = [
        {
          amount: Number(totalPaymentAmount),
          date:
            fee.payments?.[0]?.date || new Date().toISOString().slice(0, 10),
          method: fee.payments?.[0]?.method || "Unknown",
        },
      ];

      const updatedFee = await feesCollection.findOneAndUpdate(
        { _id: new ObjectId(id) },
        {
          $set: {
            students,
            remaining: Number(remaining.toFixed(2)),
            status: newStatus,
            payments: updatedPayments,
          },
        },
        { returnDocument: "after" }
      );

      res.send({
        message: "Payment updated successfully",
        updatedFee,
        changes: {
          previousAmount: fee.payments?.[0]?.amount || 0,
          newAmount: totalPaymentAmount,
          statusChanged: fee.status !== newStatus,
        },
      });
    } catch (err) {
      console.error("Payment update error:", err);
      res.status(500).send({ message: "Internal server error" });
    }
  });

  // delete
  router.delete("/:id", async (req, res) => {
    const { id } = req.params;
    const query = { _id: new ObjectId(id) };
    const result = await feesCollection.deleteOne(query);
    res.send(result);
  });

  return router;
};
