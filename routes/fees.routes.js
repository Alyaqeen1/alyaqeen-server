const express = require("express");
const { ObjectId } = require("mongodb");
const sendEmailViaAPI = require("../config/sendAdmissionEmail");
const sendHoldEmail = require("../config/sendHoldEmail");
const sendMonthlyFeeEmail = require("../config/sendMonthlyFeeEmail");
const router = express.Router();
const { addDays, isBefore, format, isValid } = require("date-fns");
// const { isValid, parseISO } = require("date-fns");
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
      const { month, year, paymentType } = req.query;

      let query = { payments: { $exists: true, $ne: [] } };

      // Filter by payment type if provided
      if (paymentType) {
        if (paymentType === "monthly") {
          query.paymentType = { $in: ["monthly", "monthlyOnHold"] };

          // ✅ REMOVED: Month/year filtering in MongoDB query
          // We'll handle this in client-side processing
        } else if (paymentType === "admission") {
          query.paymentType = { $in: ["admission", "admissionOnHold"] };
        }
      }

      const result = await feesCollection
        .find(query)
        .sort({ timestamp: -1 })
        .toArray();

      // ✅ COMPLETE CLIENT-SIDE PROCESSING FOR MONTHLY PAYMENTS
      let processedResults = result;

      if (paymentType === "monthly" && month && year) {
        const monthNum = parseInt(month);
        const yearNum = parseInt(year);
        const monthStr = monthNum.toString().padStart(2, "0");

        processedResults = result
          .map((fee) => {
            // Create a copy of the fee
            const feeCopy = JSON.parse(JSON.stringify(fee));

            // Filter students to only include those with the specified month
            feeCopy.students = fee.students
              .map((student) => {
                // Find the specific month payment for this student
                const monthPayment = student.monthsPaid?.find(
                  (mp) =>
                    mp.month === monthStr &&
                    mp.year === yearNum &&
                    (mp.paid || 0) > 0
                );

                if (!monthPayment) {
                  return null; // This student doesn't have payment for the specified month
                }

                // Create a student object with ONLY the specified month
                return {
                  ...student,
                  monthsPaid: [monthPayment], // Only include the requested month
                  subtotal: monthPayment.paid || 0, // Update subtotal to only this month's payment
                };
              })
              .filter((student) => student !== null); // Remove students without the specified month

            // If no students left after filtering, exclude this fee entirely
            if (feeCopy.students.length === 0) {
              return null;
            }

            // Recalculate totals for the filtered data
            feeCopy.expectedTotal = feeCopy.students.reduce(
              (sum, student) =>
                sum + (student.monthsPaid[0]?.discountedFee || 0),
              0
            );

            feeCopy.remaining = Math.max(
              0,
              feeCopy.expectedTotal -
                feeCopy.students.reduce(
                  (sum, student) => sum + (student.subtotal || 0),
                  0
                )
            );

            return feeCopy;
          })
          .filter((fee) => fee !== null); // Remove fees with no matching students
      }

      res.send(processedResults);
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

      // ✅ NEW: Check if this is a monthly payment with multiple months
      const isMonthlyPayment =
        paymentType === "monthly" || paymentType === "monthlyOnHold";

      if (isMonthlyPayment) {
        // ✅ GROUP PAYMENTS BY MONTH-YEAR COMBINATION
        const monthlyPayments = [];

        students.forEach((student) => {
          student.monthsPaid?.forEach((monthData) => {
            if (monthData.paid > 0) {
              const monthYearKey = `${monthData.month}-${monthData.year}`;

              // Find or create month entry
              let monthEntry = monthlyPayments.find(
                (m) => m.monthYear === monthYearKey
              );
              if (!monthEntry) {
                monthEntry = {
                  monthYear: monthYearKey,
                  month: monthData.month,
                  year: monthData.year,
                  students: [],
                  totalAmount: 0,
                };
                monthlyPayments.push(monthEntry);
              }

              // Add student to this month
              monthEntry.students.push({
                studentId: student.studentId,
                name: student.name,
                monthData: monthData,
                subtotal: monthData.paid,
              });

              monthEntry.totalAmount += monthData.paid;
            }
          });
        });
        // ✅ CREATE SEPARATE DOCUMENTS FOR EACH MONTH
        if (monthlyPayments.length > 0) {
          const results = [];

          for (const monthPayment of monthlyPayments) {
            // ✅ FIX: Get the actual payment method from the payments array
            const actualMethod = feesData.payments?.[0]?.method || method;

            // ✅ FIX: Set status based on payment type
            const status = paymentType === "monthlyOnHold" ? "pending" : "paid";

            // Create individual fee document for each month
            const individualFeeData = {
              familyId: familyId,
              name: familyName,
              email: familyEmail,
              students: monthPayment.students.map((s) => ({
                studentId: s.studentId,
                name: s.name,
                monthsPaid: [s.monthData], // Only one month per document
                subtotal: s.subtotal,
              })),
              expectedTotal: monthPayment.totalAmount,
              remaining: 0, // Since we're creating separate documents, each is fully paid
              status: status, // ✅ FIXED: Use dynamic status
              paymentType: paymentType,
              payments: [
                {
                  amount: monthPayment.totalAmount,
                  method: actualMethod, // ✅ FIXED: Use actual method from payments
                  date:
                    feesData.payments?.[0]?.date ||
                    new Date().toISOString().slice(0, 10),
                },
              ],
              timestamp: new Date(),
            };

            // Save individual month document
            const result = await feesCollection.insertOne(individualFeeData);
            results.push(result);
          }

          // ✅ SEND SINGLE COMBINED EMAIL FOR ALL MONTHS
          try {
            // ✅ FIX: Also use actual method for email
            const actualMethod = feesData.payments?.[0]?.method || method;

            // Prepare combined students data for email (all months together)
            const studentsForEmail = students.map((student) => ({
              name: student.name,
              monthsPaid: student.monthsPaid || [],
              subtotal: student.subtotal,
            }));

            // Calculate totals for email
            const totalPaidAmount = studentsForEmail.reduce(
              (sum, student) => sum + student.subtotal,
              0
            );

            await sendMonthlyFeeEmail({
              to: familyEmail,
              parentName: familyName,
              students: studentsForEmail,
              totalAmount: totalPaidAmount,
              method: actualMethod, // ✅ FIXED: Use actual method for email
              paymentDate:
                feesData.payments?.[0]?.date ||
                new Date().toISOString().slice(0, 10),
              isOnHold: paymentType === "monthlyOnHold",
              remainingAmount: 0, // Since we're creating separate paid documents
            });
          } catch (emailError) {
            console.error("❌ Monthly fee email failed:", emailError);
          }

          return res.send({
            message: `Created ${monthlyPayments.length} monthly fee document(s)`,
            insertedIds: results.map((r) => r.insertedId),
            monthlyBreakdown: monthlyPayments.map((m) => ({
              month: m.month,
              year: m.year,
              totalAmount: m.totalAmount,
            })),
          });
        }
      }

      // ✅ EXISTING LOGIC FOR NON-MONTHLY PAYMENTS (admission, etc.)
      // 4. Optionally add timestamp
      feesData.timestamp = new Date();
      if (
        paymentType === "admissionOnHold" ||
        paymentType === "monthlyOnHold"
      ) {
        feesData.status = "pending";
      } else {
        feesData.status = "paid";
      }

      // 5. Save fee document (for non-monthly payments)
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

      // ✅ EXISTING EMAIL LOGIC FOR ADMISSION PAYMENTS
      if (paymentType === "admissionOnHold") {
        try {
          await sendHoldEmail({
            to: familyEmail,
            parentName: familyName,
            studentNames: allStudents.map((s) => s.name),
            method: paymentMethod,
            amount: paidAmount,
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

          const studentBreakdown = enrichedStudents.map((enrichedStudent) => {
            const originalStudent = feesData.students.find(
              (s) => String(s.studentId) === String(enrichedStudent._id)
            );

            const totalPaid = originalStudent?.subtotal || 0;

            return {
              ...enrichedStudent,
              subtotal: totalPaid,
            };
          });

          await sendEmailViaAPI({
            to: familyEmail,
            parentName: familyName,
            students: studentBreakdown,
            totalAmount: paidAmount,
            method: paymentMethod,
            paymentDate: paymentDate,
            studentBreakdown: studentBreakdown,
            isEnrollmentConfirmed: true,
          });
        } catch (admissionError) {
          console.error("❌ Admission email process failed:", admissionError);
        }
      } else {
        console.log("ℹ️ No email sent for payment type:", paymentType);
      }

      res.send(result);
    } catch (err) {
      console.error("💥 CRITICAL ERROR in fee creation:", err);
      res.status(500).send({
        message: "Internal server error",
        error: err.message,
      });
    }
  });

  // router.post("/", async (req, res) => {
  //   const feesData = req.body;
  //   const {
  //     familyId,
  //     amount,
  //     paymentType,
  //     students = [],
  //     method = "Unknown",
  //   } = feesData;

  //   try {
  //     // 1. Get the family document
  //     const family = await familiesCollection.findOne({
  //       _id: new ObjectId(familyId),
  //     });

  //     if (!family || !Array.isArray(family.children)) {
  //       return res
  //         .status(404)
  //         .send({ message: "Family not found or has no children." });
  //     }

  //     const familyName = family?.name || "Parent";
  //     const familyEmail = family?.email;

  //     if (!familyEmail) {
  //       return res.status(400).send({ message: "Family email is required." });
  //     }

  //     // 2. Extract studentIds from students
  //     const studentIds = students?.map((s) => new ObjectId(s.studentId));

  //     // 3. Fetch full student records
  //     const allStudents = await studentsCollection
  //       .find({ _id: { $in: studentIds } })
  //       .toArray();

  //     if (!allStudents.length) {
  //       return res
  //         .status(404)
  //         .send({ message: "No matching students found in the database." });
  //     }

  //     // 4. Optionally add timestamp
  //     feesData.timestamp = new Date();

  //     // 5. Save fee document
  //     const result = await feesCollection.insertOne(feesData);

  //     // ✅ FIXED: Calculate actual values from payments array
  //     const paidAmount =
  //       feesData.payments?.reduce(
  //         (sum, payment) => sum + (payment.amount || 0),
  //         0
  //       ) || 0;
  //     const paymentMethod = feesData.payments?.[0]?.method || method;
  //     const paymentDate =
  //       feesData.payments?.[0]?.date || new Date().toISOString().slice(0, 10);
  //     const remainingAmount = feesData.remaining || 0;

  //     // ✅ FIXED: Monthly email with correct data
  //     // 5. Send Monthly Email with month info
  //     if (paymentType === "monthly" || paymentType === "monthlyOnHold") {
  //       try {
  //         // Prepare students data for email
  //         const studentsForEmail = feesData.students.map((s) => ({
  //           name: s.name,
  //           monthsPaid: (s.monthsPaid || []).map((m) => ({
  //             month: m.month,
  //             year: m.year,
  //             monthlyFee: m.monthlyFee,
  //             discountedFee: m.discountedFee,
  //             paid: m.paid,
  //           })),
  //           subtotal: s.subtotal,
  //         }));

  //         await sendMonthlyFeeEmail({
  //           to: familyEmail,
  //           parentName: familyName,
  //           students: studentsForEmail,
  //           totalAmount: paidAmount,
  //           method: paymentMethod,
  //           paymentDate: paymentDate,
  //           isOnHold: paymentType === "monthlyOnHold",
  //           remainingAmount: remainingAmount,
  //         });
  //       } catch (emailError) {
  //         console.error("❌ Monthly fee email failed:", emailError);
  //       }
  //     }

  //     // 6. Send Email based on type
  //     // 6. Send Email based on type
  //     if (paymentType === "admissionOnHold") {
  //       try {
  //         await sendHoldEmail({
  //           to: familyEmail,
  //           parentName: familyName,
  //           studentNames: allStudents.map((s) => s.name),
  //           method: paymentMethod,
  //           amount: paidAmount, // ✅ ADD THIS - pass the actual paid amount
  //         });
  //         console.log("✅ Hold email sent successfully");
  //       } catch (emailError) {
  //         console.error("❌ Hold email failed:", emailError);
  //       }
  //     } else if (paymentType === "admission") {
  //       console.log("📧 Processing admission email...");
  //       try {
  //         const enrichedStudents = await enrichStudents(
  //           feesData.students,
  //           studentsCollection,
  //           departmentsCollection,
  //           classesCollection
  //         );

  //         // ✅ SIMPLIFIED: Only show paid amounts and enrollment confirmation
  //         const studentBreakdown = enrichedStudents.map((enrichedStudent) => {
  //           // Find the original fee data for this student
  //           const originalStudent = feesData.students.find(
  //             (s) => String(s.studentId) === String(enrichedStudent._id)
  //           );

  //           const totalPaid = originalStudent?.subtotal || 0;

  //           return {
  //             ...enrichedStudent, // Academic info
  //             subtotal: totalPaid, // Only show what was actually paid
  //             // Remove all expected/remaining calculations
  //           };
  //         });

  //         await sendEmailViaAPI({
  //           to: familyEmail,
  //           parentName: familyName,
  //           students: studentBreakdown,
  //           totalAmount: paidAmount, // This shows the actual paid amount
  //           method: paymentMethod,
  //           paymentDate: paymentDate,
  //           // ✅ REMOVED: remainingAmount - don't show remaining balance
  //           // ✅ REMOVED: studentBreakdown with remaining calculations
  //           studentBreakdown: studentBreakdown,
  //           // Add enrollment confirmation message
  //           isEnrollmentConfirmed: true,
  //         });
  //       } catch (admissionError) {
  //         console.error("❌ Admission email process failed:", admissionError);
  //         // Don't fail the request if email fails
  //       }
  //     } else {
  //       console.log("ℹ️ No email sent for payment type:", paymentType);
  //     }

  //     res.send(result);
  //   } catch (err) {
  //     console.error("💥 CRITICAL ERROR in fee creation:", err);
  //     res.status(500).send({
  //       message: "Internal server error",
  //       error: err.message,
  //     });
  //   }
  // });

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
                  paymentDate: paymentDate,
                  status: fee.status,
                  paymentType: fee.paymentType,
                  feeId: fee._id,
                  isFirstMonth: false,
                  paymentMethod: fee.payments?.[0]?.method || "N/A",
                });
              }
            });
          }
        }

        // Handle admission fees - SIMPLIFIED: No partial payments
        if (
          fee.paymentType === "admission" ||
          fee.paymentType === "admissionOnHold"
        ) {
          // Extract first month payment from admission fee
          if (feeStudent.joiningMonth && feeStudent.joiningYear) {
            const monthKey = `${
              feeStudent.joiningYear
            }-${feeStudent.joiningMonth.toString().padStart(2, "0")}`;

            // ✅ SIMPLIFIED: Always treat admission as fully paid for the first month
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

            // ✅ REMOVED: Partial payment logic - always consider first month as paid
            // If any payment was made, consider the first month as paid
            if (firstMonthPaid > 0 && !paidMonths.has(monthKey)) {
              paidMonths.add(monthKey);

              // Use the monthly fee amount, not the actual paid amount
              const monthlyFeeAmount =
                feeStudent.monthlyFee || feeStudent.monthly_fee || 50;
              totalMonthlyPaid += monthlyFeeAmount;

              monthlyPayments.push({
                month: monthKey,
                displayMonth: formatDisplayMonth(monthKey),
                amount: monthlyFeeAmount, // Show the full monthly fee amount, not partial
                paymentDate: paymentDate,
                status: "paid", // ✅ Always show as paid
                paymentType: fee.paymentType,
                feeId: fee._id,
                isFirstMonth: true,
                paymentMethod: fee.payments?.[0]?.method || "N/A",
              });
            }
          }
        }

        // Track all payments for this student
        allStudentPayments.push({
          _id: fee._id,
          amount: feeStudent.subtotal || 0,
          status: fee.status,
          paymentType: fee.paymentType,
          timestamp: paymentDate,
          studentPortion: feeStudent.subtotal || 0,
          paymentMethod: fee.payments?.[0]?.method || "N/A",
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
        const currentMonth = new Date(
          currentDate.getFullYear(),
          currentDate.getMonth(),
          1
        ); // 1st of current month

        let currentIterationMonth = new Date(lastPaidDate);
        currentIterationMonth.setMonth(currentIterationMonth.getMonth() + 1);

        while (currentIterationMonth <= currentMonth) {
          const monthKey = format(currentIterationMonth, "yyyy-MM");
          const monthDate = new Date(monthKey + "-01");

          if (monthDate >= september2025) {
            const paidMonth = monthlyPayments.find((p) => p.month === monthKey);
            if (!paidMonth) {
              // ✅ Only count if completely unpaid (no partial logic)
              consecutiveUnpaidMonths++;
            } else {
              break;
            }
          }
          currentIterationMonth.setMonth(currentIterationMonth.getMonth() + 1);
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
            paymentDate: payment.paymentDate,
            status: payment.status,
            paymentType: payment.paymentType,
            feeId: payment.feeId,
            isFirstMonth: payment.isFirstMonth || false,
            note: payment.note || null,
            paymentMethod: payment.paymentMethod || "N/A", // Add this line
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

  // Updated getUnpaidFees function - uses 1st of month and respects joining date
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

    // Build payment map from fee records
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

      // ✅ FIXED: Calculate months from 1st of each month, not starting date
      let currentDate = new Date();
      let currentMonth = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        1
      ); // Start from 1st of current month

      // ✅ FIXED: Don't show months before joining as unpaid
      let startDate = new Date(startingDate);
      let september2025 = new Date("2025-09-01");

      // Use the later date between student's starting date and September 2025
      let payableMonth = startDate > september2025 ? startDate : september2025;
      payableMonth = new Date(
        payableMonth.getFullYear(),
        payableMonth.getMonth(),
        1
      ); // Ensure 1st of month

      while (payableMonth <= currentMonth) {
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

    try {
      // Step 1: Get all fees with payments
      const result = await feesCollection
        .find({
          familyId: id,
          payments: { $exists: true, $ne: [] },
        })
        .toArray();

      // Step 2: Flatten payment data from all students across all docs
      let allMonths = [];

      result.forEach((fee) => {
        fee.students.forEach((student) => {
          // ✅ CASE 1: Monthly fees with monthsPaid array
          if (student.monthsPaid && Array.isArray(student.monthsPaid)) {
            student.monthsPaid.forEach((m) => {
              if (m.paid > 0) {
                // Only include months with actual payments
                allMonths.push({
                  studentId: student.studentId,
                  name: student.name,
                  month: parseInt(m.month, 10),
                  year: parseInt(m.year, 10),
                  amount: m.paid || 0,
                  status: fee.status,
                  paidDate:
                    fee.payments?.[0]?.date || fee.timestamp || new Date(),
                  feeType: "monthly",
                  originalFeeId: fee._id,
                });
              }
            });
          }

          // ✅ CASE 2: Admission fees - calculate first month payment from payments array
          else if (
            fee.paymentType === "admission" ||
            fee.paymentType === "admissionOnHold"
          ) {
            const joiningMonth = parseInt(student.joiningMonth, 10);
            const joiningYear = parseInt(student.joiningYear, 10);

            if (joiningMonth && joiningYear && student.subtotal > 0) {
              // Calculate how much was paid for the first month
              const admissionFee = student.admissionFee || 20;
              const monthlyFee = student.monthlyFee || 50;
              const totalPaid = student.subtotal || 0;

              // First £20 goes to admission, rest goes to first month
              const firstMonthPaid = Math.max(0, totalPaid - admissionFee);

              if (firstMonthPaid > 0) {
                allMonths.push({
                  studentId: student.studentId,
                  name: student.name,
                  month: joiningMonth,
                  year: joiningYear,
                  amount: firstMonthPaid,
                  status: fee.status,
                  paidDate:
                    fee.payments?.[0]?.date || fee.timestamp || new Date(),
                  feeType: "admission_first_month",
                  originalFeeId: fee._id,
                });
              }
            }
          }

          // ✅ CASE 3: If no monthsPaid but student has subtotal (fallback)
          else if (student.subtotal > 0) {
            // Try to extract month from timestamp as fallback
            const feeDate = new Date(fee.timestamp || fee.payments?.[0]?.date);
            allMonths.push({
              studentId: student.studentId,
              name: student.name,
              month: feeDate.getMonth() + 1, // 1-12
              year: feeDate.getFullYear(),
              amount: student.subtotal || 0,
              status: fee.status,
              paidDate: fee.payments?.[0]?.date || fee.timestamp,
              feeType: "fallback",
              originalFeeId: fee._id,
            });
          }
        });
      });

      // Step 3: Keep only months >= Sep 2025
      allMonths = allMonths.filter(
        (m) => m.year > 2025 || (m.year === 2025 && m.month >= 9)
      );

      // Step 4: GROUP BY MONTH (year-month combination)
      const monthGroups = {};

      allMonths.forEach((month) => {
        const monthKey = `${month.year}-${month.month
          .toString()
          .padStart(2, "0")}`;

        if (!monthGroups[monthKey]) {
          monthGroups[monthKey] = {
            month: month.month,
            year: month.year,
            students: [],
            totalAmount: 0,
            status: month.status,
            paidDate: month.paidDate,
            feeIds: new Set(), // Track unique fee IDs
          };
        }

        // Add student to this month group
        monthGroups[monthKey].students.push({
          studentId: month.studentId,
          name: month.name,
          amount: month.amount,
        });

        // Add to total amount
        monthGroups[monthKey].totalAmount += month.amount;

        // Track fee IDs
        monthGroups[monthKey].feeIds.add(month.originalFeeId.toString());

        // Use the most recent status if multiple
        if (month.status === "paid") {
          monthGroups[monthKey].status = "paid";
        }
      });

      // Step 5: Convert to array and sort by date (most recent first)
      let monthArray = Object.values(monthGroups);

      monthArray.sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.month - a.month;
      });

      // Step 6: Take only the last 2 months
      const lastTwoMonths = monthArray.slice(0, 2);

      // Step 7: Format the response for frontend
      const formattedResult = lastTwoMonths.map((monthGroup) => {
        const monthNames = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];
        const monthName = monthNames[monthGroup.month - 1] || monthGroup.month;

        return {
          displayMonth: `${monthName} ${monthGroup.year}`,
          students: monthGroup.students.map((s) => s.name).join(", "),
          amount: monthGroup.totalAmount,
          status: monthGroup.status,
          paidDate: monthGroup.paidDate,
          studentCount: monthGroup.students.length,
          originalFeeIds: Array.from(monthGroup.feeIds), // For modal if needed
        };
      });

      res.send(formattedResult);
    } catch (error) {
      console.error("Error fetching fees:", error);
      res.status(500).send({ message: "Internal server error" });
    }
  });
  router.get("/by-fee-id/:id", async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await feesCollection.findOne(query);
    res.send(result);
  });

  // GET /api/fees/unpaid-months/:familyId
  // GET /api/fees/unpaid-months/:familyId
  router.get("/unpaid-months/:familyId", async (req, res) => {
    try {
      const { familyId } = req.params;
      const discountQuery = Number(req.query.discount || 0);

      // Find family document by _id
      const family = await familiesCollection.findOne({
        _id: new ObjectId(familyId),
      });

      if (!family) {
        return res.status(404).json({
          success: false,
          message: "Family not found",
        });
      }

      const familyDiscount =
        family && family.discount !== undefined && family.discount !== null
          ? Number(family.discount) || 0
          : discountQuery;

      // ✅ Get ONLY ENROLLED students from family.children UIDs
      let enrolledStudents = [];

      if (family.children && Array.isArray(family.children)) {
        const studentUIDs = family.children
          .filter((uid) => uid && typeof uid === "string")
          .map((uid) => uid.trim())
          .filter((uid) => uid.length > 0);

        if (studentUIDs.length > 0) {
          // ✅ CRITICAL FIX: Only get students with status "enrolled"
          enrolledStudents = await studentsCollection
            .find({
              uid: { $in: studentUIDs },
              status: "enrolled", // ✅ Only enrolled students
              activity: { $ne: "inactive" },
            })
            .project({
              _id: 1,
              uid: 1,
              name: 1,
              startingDate: 1,
              monthly_fee: 1,
              monthlyFee: 1,
              status: 1,
            })
            .toArray();
        }
      }

      if (enrolledStudents.length === 0) {
        return res.json({
          success: true,
          familyId,
          unpaidMonths: [],
          message: "No enrolled students found for this family",
        });
      }

      // ✅ Get ALL fee records (monthly AND admission types)
      const allFees = await feesCollection
        .find({
          familyId: familyId,
          paymentType: {
            $in: ["monthly", "monthlyOnHold", "admission", "admissionOnHold"],
          },
          status: { $in: ["paid", "pending", "partial"] },
        })
        .toArray();

      // ✅ Separate monthly fees and admission fees
      const monthlyFees = allFees.filter(
        (fee) =>
          fee.paymentType === "monthly" || fee.paymentType === "monthlyOnHold"
      );

      const admissionFees = allFees.filter(
        (fee) =>
          fee.paymentType === "admission" ||
          fee.paymentType === "admissionOnHold"
      );

      // ✅ Build allStudents ONLY from enrolled students
      const allStudents = new Map();
      const paidMonthsMap = new Map();

      // Build student info ONLY from enrolled students
      enrolledStudents.forEach((student) => {
        // ✅ Only process if student status is "enrolled"
        if (student.status === "enrolled") {
          const studentIdStr = String(student._id);
          const monthlyFee = Number(
            student.monthly_fee ?? student.monthlyFee ?? 50
          );

          allStudents.set(studentIdStr, {
            studentId: studentIdStr,
            name: student.name || "Unknown",
            monthly_fee: monthlyFee,
            startingDate: student.startingDate,
            status: student.status, // Keep status for reference
          });
        }
      });

      // ✅ Build paidMonthsMap from MONTHLY fees
      for (const fee of monthlyFees) {
        for (const s of fee.students || []) {
          const studentIdStr = String(s.studentId);

          // ✅ Only consider if student is in enrolled students
          if (allStudents.has(studentIdStr)) {
            if (Array.isArray(s.monthsPaid)) {
              for (const mp of s.monthsPaid) {
                const monthNum = Number(mp.month);
                const year = mp.year;
                if (!isNaN(monthNum) && year) {
                  const monthStr = `${year}-${String(monthNum).padStart(
                    2,
                    "0"
                  )}`;
                  const paidAmount = mp.paid || mp.Paid || 0;

                  if (paidAmount > 0) {
                    paidMonthsMap.set(`${studentIdStr}_${monthStr}`, true);
                  }
                }
              }
            }
          }
        }
      }

      // ✅ Check ADMISSION fees for joining month payments
      for (const fee of admissionFees) {
        for (const s of fee.students || []) {
          const studentIdStr = String(s.studentId);

          // ✅ Only consider if student is in enrolled students
          if (allStudents.has(studentIdStr)) {
            // If admission payment exists and has joining month, mark that month as paid
            if (s.joiningMonth && s.joiningYear) {
              const monthStr = `${s.joiningYear}-${String(
                s.joiningMonth
              ).padStart(2, "0")}`;
              paidMonthsMap.set(`${studentIdStr}_${monthStr}`, true);
            }
          }
        }
      }

      // ✅ YOUR EXISTING LOGIC FOR UNPAID MONTHS - ONLY FOR ENROLLED STUDENTS
      const grouped = {};
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;

      // For each ENROLLED student, generate months but respect starting dates
      for (const [studentIdStr, sInfo] of allStudents.entries()) {
        // ✅ Double-check: Only process enrolled students
        if (sInfo.status !== "enrolled") {
          continue; // Skip non-enrolled students
        }

        const feeAmount = Number(sInfo.monthly_fee) || 50;

        // ✅ Determine start date: Use student startingDate OR September 2025 (whichever is later)
        let startDate = new Date(2025, 8, 1); // September 2025

        if (sInfo.startingDate) {
          const studentStartDate = new Date(sInfo.startingDate);
          // Use the later date: September 2025 OR student start date
          startDate =
            studentStartDate > startDate ? studentStartDate : startDate;
        }

        // If start date is in future, skip this student
        if (startDate > now) {
          continue;
        }

        const addUnpaidMonth = (monthStr, year, month) => {
          const key = `${studentIdStr}_${monthStr}`;
          if (paidMonthsMap.has(key)) {
            return;
          }

          // compute discounted fee using familyDiscount
          const discountedFee = Number(
            (feeAmount * (1 - familyDiscount / 100)).toFixed(2)
          );

          if (!grouped[monthStr]) {
            grouped[monthStr] = {
              totalAmount: 0,
              studentNames: new Set(),
              studentsMap: {},
            };
          }

          grouped[monthStr].totalAmount += discountedFee;
          grouped[monthStr].studentNames.add(sInfo.name || "Unknown");

          if (!grouped[monthStr].studentsMap[studentIdStr]) {
            grouped[monthStr].studentsMap[studentIdStr] = {
              studentId: studentIdStr,
              name: sInfo.name || "Unknown",
              subtotal: 0,
              monthsUnpaid: [],
            };
          }

          grouped[monthStr].studentsMap[studentIdStr].monthsUnpaid.push({
            month: monthStr,
            monthlyFee: feeAmount,
            discountedFee,
          });

          grouped[monthStr].studentsMap[studentIdStr].subtotal += discountedFee;
        };

        // Generate months from start date to current month
        let checkDate = new Date(startDate);

        while (
          checkDate.getFullYear() < currentYear ||
          (checkDate.getFullYear() === currentYear &&
            checkDate.getMonth() + 1 <= currentMonth)
        ) {
          const y = checkDate.getFullYear();
          const m = checkDate.getMonth() + 1;
          const monthStr = `${y}-${String(m).padStart(2, "0")}`;
          addUnpaidMonth(monthStr, y, m);
          checkDate.setMonth(checkDate.getMonth() + 1);
        }
      }

      // Format grouped -> sorted unpaidMonths array
      const sortedMonths = Object.keys(grouped).sort((a, b) => {
        const [yA, mA] = a.split("-").map(Number);
        const [yB, mB] = b.split("-").map(Number);
        if (yA !== yB) return yA - yB;
        return mA - mB;
      });

      const unpaidMonths = sortedMonths.map((monthStr) => {
        const data = grouped[monthStr];
        return {
          month: monthStr,
          totalAmount: parseFloat((data.totalAmount || 0).toFixed(2)),
          studentNames: Array.from(data.studentNames).join(", "),
          students: Object.values(data.studentsMap).map((stu) => ({
            ...stu,
            subtotal: parseFloat((stu.subtotal || 0).toFixed(2)),
          })),
        };
      });

      res.json({
        success: true,
        familyId,
        unpaidMonths,
        summary: {
          totalUnpaidMonths: unpaidMonths.length,
          totalAmountDue: unpaidMonths.reduce(
            (sum, m) => sum + (m.totalAmount || 0),
            0
          ),
          studentCount: allStudents.size, // This now only includes enrolled students
          enrolledStudentCount: enrolledStudents.length,
          monthlyFeeRecords: monthlyFees.length,
          admissionFeeRecords: admissionFees.length,
          familyDiscount: familyDiscount,
          paidMonthsCount: paidMonthsMap.size,
        },
      });
    } catch (error) {
      console.error("❌ Error in unpaid-months route:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message,
      });
    }
  });
  // router.get("/unpaid-months/:familyId", async (req, res) => {
  //   try {
  //     const { familyId } = req.params;
  //     const { discount = 0 } = req.query;

  //     // Get all fee records for this family
  //     const fees = await feesCollection
  //       .find({
  //         familyId: familyId,
  //         paymentType: { $in: ["monthly", "monthlyOnHold"] },
  //         status: { $in: ["paid", "pending"] },
  //       })
  //       .toArray();

  //     if (fees.length === 0) {
  //       return res.json({
  //         success: true,
  //         familyId,
  //         unpaidMonths: [],
  //         message: "No fee records found for this family",
  //       });
  //     }

  //     // Extract all students and their paid months from the fees
  //     const allStudents = new Map(); // studentId -> { student data }
  //     const paidMonthsMap = new Map(); // studentId_month -> true

  //     // After fetching fees...
  //     const studentIds = [
  //       ...new Set(
  //         fees.flatMap(
  //           (fee) => fee.students?.map((s) => s.studentId?.toString()) || []
  //         )
  //       ),
  //     ].filter(Boolean);

  //     // ✅ Fetch student details once to check activity
  //     const studentDocs = await studentsCollection
  //       .find({ _id: { $in: studentIds.map((id) => new ObjectId(id)) } })
  //       .project({ _id: 1, name: 1, activity: 1, status: 1 })
  //       .toArray();

  //     const activeStudentIds = new Set(
  //       studentDocs
  //         .filter((s) => s.activity !== "inactive" && s.status !== "inactive")
  //         .map((s) => s._id.toString())
  //     );

  //     // Then when processing each student
  //     fees.forEach((fee) => {
  //       fee.students?.forEach((student) => {
  //         const studentId = student.studentId?.toString();

  //         // ✅ Skip inactive students
  //         if (!activeStudentIds.has(studentId)) return;

  //         // Store student info
  //         if (!allStudents.has(studentId)) {
  //           allStudents.set(studentId, {
  //             studentId: studentId,
  //             name: student.name,
  //             monthly_fee: student.monthlyFee || student.monthly_fee || 50,
  //           });
  //         }

  //         // Mark paid months (no change)
  //         if (Array.isArray(student.monthsPaid)) {
  //           student.monthsPaid.forEach((monthPaid) => {
  //             const monthNum = parseInt(monthPaid.month, 10);
  //             const year = monthPaid.year;

  //             if (monthNum && year) {
  //               const monthStr = `${year}-${monthNum
  //                 .toString()
  //                 .padStart(2, "0")}`;
  //               const key = `${studentId}_${monthStr}`;
  //               paidMonthsMap.set(key, true);
  //             }
  //           });
  //         }
  //       });
  //     });

  //     const grouped = {};
  //     const currentDate = new Date();
  //     const currentYear = currentDate.getFullYear();
  //     const currentMonth = currentDate.getMonth() + 1;

  //     // Process each student to find unpaid months
  //     allStudents.forEach((student, studentId) => {
  //       const { name, monthly_fee } = student;
  //       const fee = monthly_fee || 50;

  //       const addUnpaidMonth = (monthStr, year, month) => {
  //         const key = `${studentId}_${monthStr}`;

  //         if (paidMonthsMap.has(key)) {
  //           return;
  //         }

  //         const discountedFee = fee - (fee * discount) / 100;

  //         if (!grouped[monthStr]) {
  //           grouped[monthStr] = {
  //             totalAmount: 0,
  //             studentNames: new Set(),
  //             studentsMap: {},
  //           };
  //         }

  //         grouped[monthStr].totalAmount += discountedFee;
  //         grouped[monthStr].studentNames.add(name);

  //         if (!grouped[monthStr].studentsMap[studentId]) {
  //           grouped[monthStr].studentsMap[studentId] = {
  //             studentId,
  //             name,
  //             subtotal: 0,
  //             monthsUnpaid: [],
  //           };
  //         }

  //         grouped[monthStr].studentsMap[studentId].monthsUnpaid.push({
  //           month: monthStr,
  //           monthlyFee: fee,
  //           discountedFee: parseFloat(discountedFee.toFixed(2)),
  //         });

  //         grouped[monthStr].studentsMap[studentId].subtotal += discountedFee;
  //       };

  //       // Generate all months from September 2025 to current month
  //       const startDate = new Date(2025, 8, 1); // September 1, 2025
  //       const checkDate = new Date(startDate);

  //       while (
  //         checkDate.getFullYear() < currentYear ||
  //         (checkDate.getFullYear() === currentYear &&
  //           checkDate.getMonth() + 1 <= currentMonth)
  //       ) {
  //         const year = checkDate.getFullYear();
  //         const month = checkDate.getMonth() + 1;
  //         const monthStr = `${year}-${month.toString().padStart(2, "0")}`;

  //         addUnpaidMonth(monthStr, year, month);
  //         checkDate.setMonth(checkDate.getMonth() + 1);
  //       }
  //     });

  //     // Sort months chronologically and format response
  //     const sortedMonths = Object.keys(grouped).sort((a, b) => {
  //       const [yearA, monthA] = a.split("-").map(Number);
  //       const [yearB, monthB] = b.split("-").map(Number);
  //       if (yearA !== yearB) return yearA - yearB;
  //       return monthA - monthB;
  //     });

  //     const unpaidMonths = sortedMonths.map((month) => {
  //       const data = grouped[month];
  //       return {
  //         month,
  //         totalAmount: parseFloat(data.totalAmount.toFixed(2)),
  //         studentNames: Array.from(data.studentNames).join(", "),
  //         students: Object.values(data.studentsMap).map((stu) => ({
  //           ...stu,
  //           subtotal: parseFloat(stu.subtotal.toFixed(2)),
  //         })),
  //       };
  //     });

  //     res.json({
  //       success: true,
  //       familyId,
  //       unpaidMonths,
  //       summary: {
  //         totalUnpaidMonths: unpaidMonths.length,
  //         totalAmountDue: unpaidMonths.reduce(
  //           (sum, month) => sum + month.totalAmount,
  //           0
  //         ),
  //         studentCount: allStudents.size,
  //         feeRecordsProcessed: fees.length,
  //       },
  //     });
  //   } catch (error) {
  //     console.error("❌ Error in unpaid-months route:", error);
  //     res.status(500).json({
  //       success: false,
  //       message: "Internal server error",
  //       error: error.message,
  //     });
  //   }
  // });

  // fee summary
  router.get("/by-student-id/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const { month, year } = req.query; // e.g., ?month=08&year=2025

      const query = { "students.studentId": id };
      const fees = await feesCollection.find(query).toArray();

      // If no fees found, return empty data instead of error
      if (!fees || fees.length === 0) {
        const student = await studentsCollection.findOne({
          _id: new ObjectId(id),
        });
        return res.send({
          studentId: id,
          studentName: student?.name || "Unknown",
          summaryType: month && year ? "monthly" : "overall", // Use month and year from query params
          month: month, // Use month from query params
          year: year, // Use year from query params
          totalPaid: 0,
          totalExpected: 0,
          remaining: 0,
          paymentStatus: "unpaid",
          partialPaymentAnalysis: {
            totalPayments: 0,
            partialPayments: 0,
            partialPercentage: 0,
            status: "no_partial_payments",
          },
          paymentHistory: [],
          unpaidMonths: await getUnpaidMonthsForStudent(id), // Get unpaid months
          dataSource: "current",
        });
      }

      // Filter for specific month if provided
      let filteredFees = fees;
      if (month && year) {
        filteredFees = fees.filter((fee) => {
          if (
            fee.paymentType === "monthly" ||
            fee.paymentType === "monthlyOnHold"
          ) {
            return fee.students.some(
              (student) =>
                student.studentId === id &&
                student.monthsPaid?.some(
                  (mp) => mp.month === month && mp.year == year
                )
            );
          } else if (fee.paymentType === "admission") {
            return fee.students.some(
              (student) =>
                student.studentId === id &&
                student.joiningMonth === month &&
                student.joiningYear == year
            );
          }
          return false;
        });
      }

      // Calculate summary
      const summary = await calculateStudentSummary(
        filteredFees,
        id,
        month, // Pass month from query params
        year // Pass year from query params
      );

      res.send(summary);
    } catch (error) {
      console.error("Error fetching student fees:", error);
      res.status(500).send({ error: "Internal server error" });
    }
  });

  async function calculateStudentSummary(
    fees,
    studentId,
    selectedMonth, // This comes from the route's month parameter
    selectedYear // This comes from the route's year parameter
  ) {
    let totalPaid = 0;
    let totalExpected = 0;
    let paymentMonths = [];
    let partialPayments = 0;
    let totalPayments = 0;

    fees.forEach((fee) => {
      const studentData = fee.students.find((s) => s.studentId === studentId);
      if (!studentData) return;

      if (
        fee.paymentType === "monthly" ||
        fee.paymentType === "monthlyOnHold"
      ) {
        studentData.monthsPaid?.forEach((monthPaid) => {
          // If specific month/year filter is applied, only count that month
          if (selectedMonth && selectedYear) {
            if (
              monthPaid.month !== selectedMonth ||
              monthPaid.year != selectedYear
            )
              return;
          }

          // For legacy data without 'paid' field, infer from document status and subtotal
          const expectedFee =
            monthPaid.discountedFee || monthPaid.monthlyFee || 0;
          let paidAmount = 0;
          let paymentStatus = "unpaid";

          // If document status is "paid", assume the month was fully paid
          if (fee.status === "paid" || fee.status === "pending") {
            paidAmount = monthPaid.paid || expectedFee; // Use paid field if available, else assume fully paid
            paymentStatus =
              paidAmount >= expectedFee
                ? "fully_paid"
                : paidAmount > 0
                ? "partial"
                : "unpaid";
          }

          totalPayments++;
          totalPaid += paidAmount;
          totalExpected += expectedFee;

          paymentMonths.push({
            month: monthPaid.month,
            year: monthPaid.year,
            paid: paidAmount,
            expected: expectedFee,
            status: paymentStatus,
            type: "monthly",
            isLegacyData: !monthPaid.hasOwnProperty("paid"), // Flag for legacy data
          });

          if (paymentStatus === "partial") {
            partialPayments++;
          }
        });
      } else if (fee.paymentType === "admission") {
        // If specific month/year filter is applied, only count if joining month matches
        if (selectedMonth && selectedYear) {
          if (
            studentData.joiningMonth !== selectedMonth ||
            studentData.joiningYear != selectedYear
          )
            return;
        }

        // For admission, it's ALWAYS fully paid (system doesn't allow partial)
        const totalAdmissionExpected =
          (studentData.admissionFee || 0) +
          (studentData.discountedFee || studentData.monthlyFee || 0);
        let totalAdmissionPaid = totalAdmissionExpected; // Assume fully paid for admission

        // If there are payments array, calculate from there
        if (studentData.payments && studentData.payments.length > 0) {
          totalAdmissionPaid = studentData.payments.reduce(
            (sum, payment) => sum + payment.amount,
            0
          );
        }

        totalPayments++; // Count as ONE payment
        totalPaid += totalAdmissionPaid;
        totalExpected += totalAdmissionExpected;

        // Admission is always "fully_paid" - system doesn't allow partial
        paymentMonths.push({
          month: studentData.joiningMonth,
          year: studentData.joiningYear,
          paid: totalAdmissionPaid,
          expected: totalAdmissionExpected,
          status: "fully_paid", // Always fully paid for admission
          type: "admission_and_first_month",
        });
      }
    });

    // Calculate partial payment percentage (only for monthly payments)
    const partialPercentage =
      totalPayments > 0 ? (partialPayments / totalPayments) * 100 : 0;

    // Get unpaid months for this student
    const unpaidMonths = await getUnpaidMonthsForStudent(studentId);

    return {
      studentId,
      studentName:
        fees[0]?.students.find((s) => s.studentId === studentId)?.name ||
        "Unknown",
      summaryType: selectedMonth && selectedYear ? "monthly" : "overall",
      month: selectedMonth,
      year: selectedYear,
      totalPaid,
      totalExpected,
      remaining: totalExpected - totalPaid,
      paymentStatus:
        totalPaid >= totalExpected
          ? "fully_paid"
          : totalPaid > 0
          ? "partially_paid"
          : "unpaid",
      partialPaymentAnalysis: {
        totalPayments,
        partialPayments,
        partialPercentage: Math.round(partialPercentage * 100) / 100,
        status:
          partialPercentage === 0
            ? "no_partial_payments"
            : partialPercentage < 50
            ? "few_partial_payments"
            : partialPercentage < 100
            ? "many_partial_payments"
            : "all_partial_payments",
      },
      paymentHistory: paymentMonths.sort((a, b) => {
        // Sort by year and month
        const dateA = new Date(a.year, parseInt(a.month) - 1);
        const dateB = new Date(b.year, parseInt(b.month) - 1);
        return dateA - dateB;
      }),
      unpaidMonths, // Include unpaid months data
      dataSource: hasLegacyData(paymentMonths) ? "mixed" : "current", // Indicate if legacy data is included
    };
  }

  // Function to get unpaid months for a specific student
  async function getUnpaidMonthsForStudent(studentId) {
    try {
      // Get student data
      const student = await studentsCollection.findOne({
        _id: new ObjectId(studentId),
      });
      if (!student) return [];

      // Get all fees for this student
      const fees = await feesCollection
        .find({ "students.studentId": studentId })
        .toArray();

      // Use the existing getUnpaidFees function logic but for single student
      const monthlyPaidMap = {};

      // Build payment map from fee records
      for (const fee of fees || []) {
        if (
          (fee.paymentType === "monthly" ||
            fee.paymentType === "monthlyOnHold") &&
          (fee.status === "paid" || fee.status === "pending")
        ) {
          for (const stu of fee.students || []) {
            if (stu.studentId === studentId && Array.isArray(stu.monthsPaid)) {
              for (const { month, year } of stu.monthsPaid) {
                const monthStr = `${year}-${month.toString().padStart(2, "0")}`;
                monthlyPaidMap[monthStr] = true;
              }
            }
          }
        }
      }

      const unpaidMonths = [];
      const { name, monthly_fee, startingDate } = student;
      const fee = monthly_fee || 0;

      // Calculate payable months (from starting date or Sept 2025, whichever is later)
      let currentDate = new Date();
      let currentMonth = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        1
      );

      let startDate = new Date(startingDate);
      let september2025 = new Date("2025-09-01");

      let payableMonth = startDate > september2025 ? startDate : september2025;
      payableMonth = new Date(
        payableMonth.getFullYear(),
        payableMonth.getMonth(),
        1
      );

      while (payableMonth <= currentMonth) {
        const year = payableMonth.getFullYear();
        const month = payableMonth.getMonth() + 1;
        const monthStr = `${year}-${month.toString().padStart(2, "0")}`;

        // Check if this month is unpaid
        if (!monthlyPaidMap[monthStr]) {
          unpaidMonths.push({
            month: month.toString().padStart(2, "0"),
            year: year,
            monthStr: monthStr,
            expectedFee: fee,
            status: "unpaid",
            isCurrentMonth: isCurrentMonth(year, month),
          });
        }

        payableMonth.setMonth(payableMonth.getMonth() + 1);
      }

      return unpaidMonths;
    } catch (error) {
      console.error("Error getting unpaid months:", error);
      return [];
    }
  }

  // Helper function to check if a month is the current month
  function isCurrentMonth(year, month) {
    const currentDate = new Date();
    return (
      year === currentDate.getFullYear() && month === currentDate.getMonth() + 1
    );
  }

  function hasLegacyData(paymentMonths) {
    return paymentMonths.some((pm) => pm.isLegacyData);
  }

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

      // ✅ FIX: Calculate actual paid amount from payments array
      const paidAmount =
        fee.payments?.reduce(
          (sum, payment) => sum + (payment.amount || 0),
          0
        ) || 0;

      // ✅ FIX: Get payment method and date
      const paymentMethod = fee.payments?.[0]?.method || "Unknown";
      const paymentDate = fee.payments?.[0]?.date || new Date();

      // ✅ FIX: Calculate remaining amount properly
      const remainingAmount = fee.remaining || 0;

      // ✅ FIX: Ensure monthsPaid has the correct paid amounts
      const updatedStudents = fee.students.map((student) => {
        const updatedMonthsPaid =
          student.monthsPaid?.map((month) => ({
            ...month,
            // ✅ Ensure paid field exists and has correct value
            paid:
              month.paid !== undefined
                ? month.paid
                : month.discountedFee || month.monthlyFee || 0,
          })) || [];

        return {
          ...student,
          monthsPaid: updatedMonthsPaid,
        };
      });

      // ✅ FIX: Update BOTH the status AND the students data in database
      const result = await feesCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            status,
            paymentType: paymentType || fee.paymentType,
            students: updatedStudents, // ✅ CRITICAL: Save the updated students data
          },
        }
      );

      // 4. Send appropriate email
      if (result.modifiedCount > 0 && status === "paid") {
        if (fee.paymentType === "admissionOnHold") {
          // For admission payments
          const enrichedStudents = await enrichStudents(
            fee.students,
            studentsCollection,
            departmentsCollection,
            classesCollection
          );

          await sendEmailViaAPI({
            to: family.email,
            parentName: family.name,
            students: enrichedStudents,
            totalAmount: paidAmount,
            method: paymentMethod,
            paymentDate: paymentDate,
          });
        } else if (fee.paymentType === "monthlyOnHold") {
          await sendMonthlyFeeEmail({
            to: family.email,
            parentName: family.name,
            students: updatedStudents, // ✅ Use the UPDATED students data
            totalAmount: paidAmount,
            method: paymentMethod,
            paymentDate: paymentDate,
            isOnHold: false,
            remainingAmount: remainingAmount,
            isPartialPayment: remainingAmount > 0,
          });
        }
      }

      res.json({
        modifiedCount: result.modifiedCount,
        paidAmount,
        paymentMethod,
        emailSent: result.modifiedCount > 0 && status === "paid",
        studentsUpdated: updatedStudents.length,
      });
    } catch (err) {
      console.error("Error in update-status-mode:", err);
      res.status(500).json({ error: "Server error: " + err.message });
    }
  });
  // Update fee (partial payment for both monthly and admission)
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

    try {
      const fee = await feesCollection.findOne({ _id: new ObjectId(id) });
      if (!fee) return res.status(404).send({ message: "Fee not found" });

      // ✅ BLOCK ADMISSION PARTIAL PAYMENTS
      if (
        fee.paymentType === "admission" ||
        fee.paymentType === "admissionOnHold"
      ) {
        return res.status(400).send({
          message:
            "Partial payments are not allowed for admission fees. Please create a new admission payment instead.",
        });
      }

      // Get family for email
      const family = await familiesCollection.findOne({
        _id: new ObjectId(fee.familyId),
      });

      const discountPercent = family?.discount ? Number(family.discount) : 0;

      // ✅ Add new payment record to root payments array
      const newPayment = {
        amount: Number(partialAmount),
        method: partialMethod || "Unknown",
        date: partialDate || new Date().toISOString().slice(0, 10),
      };

      // ✅ NORMALIZE MONTH/YEAR: Ensure consistent format
      const normalizedMonth = String(month).padStart(2, "0");
      const normalizedYear = Number(year);

      // ✅ Update students based on payment type (ONLY MONTHLY NOW)
      const students = fee.students.map((s) => {
        if (studentIds.includes(String(s.studentId))) {
          // Monthly fee logic only
          if (!s.monthsPaid) s.monthsPaid = [];

          let monthEntry = s.monthsPaid.find(
            (m) =>
              String(m.month).padStart(2, "0") === normalizedMonth &&
              Number(m.year) === normalizedYear
          );

          if (monthEntry) {
            monthEntry.paid =
              Number(monthEntry.paid || 0) +
              Number(partialAmount) / studentIds.length;
          } else {
            const baseFee = s.monthlyFee || s.monthly_fee || 50;
            const discountedFee =
              discountPercent > 0
                ? Number(
                    (baseFee - (baseFee * discountPercent) / 100).toFixed(2)
                  )
                : Number(baseFee);

            s.monthsPaid.push({
              month: normalizedMonth,
              year: normalizedYear,
              monthlyFee: Number(baseFee),
              discountedFee: discountedFee,
              paid: Number(partialAmount) / studentIds.length,
            });
          }

          s.subtotal = s.monthsPaid.reduce((sum, m) => sum + (m.paid || 0), 0);
        }
        return s;
      });

      // ✅ Calculate remaining only for monthly fees
      let totalExpected = 0;
      let totalPaid = 0;

      students.forEach((s) => {
        if (studentIds.includes(String(s.studentId))) {
          totalExpected +=
            s.monthsPaid?.reduce(
              (sum, m) => sum + (m.discountedFee || m.monthlyFee || 0),
              0
            ) || 0;
          totalPaid += s.subtotal || 0;
        }
      });

      const remaining = Math.max(0, totalExpected - totalPaid);
      const newStatus =
        remaining <= 0 ? "paid" : totalPaid > 0 ? "partial" : "unpaid";

      // ✅ Update root payments array (add the new payment)
      const updatedRootPayments = [...(fee.payments || []), newPayment];

      // ✅ Update in DB
      const updateData = {
        students,
        remaining: Number(remaining.toFixed(2)),
        status: newStatus,
        payments: updatedRootPayments,
      };

      const updatedFee = await feesCollection.findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: updateData },
        { returnDocument: "after" }
      );

      // ✅ SEND EMAIL FOR PARTIAL PAYMENT (MONTHLY ONLY)
      if (family && family.email) {
        try {
          const paymentMethod =
            partialMethod || updatedFee.payments?.[0]?.method || "Unknown";
          const paymentDate =
            partialDate || new Date().toISOString().slice(0, 10);

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
        } catch (emailError) {
          console.error("❌ Partial payment email failed:", emailError);
        }
      }

      res.send({
        message: "Partial payment added",
        updatedFee,
        emailSent: !!family?.email,
        calculation: {
          totalExpected,
          totalPaid,
          remaining,
          status: newStatus,
        },
      });
    } catch (err) {
      console.error("Update fee error:", err);
      res.status(500).send({ message: "Internal server error" });
    }
  });
  // PATCH /partial-payment/:id
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

      // ✅ FIXED: For admission payments, always set remaining to 0 and status to paid
      let remaining, newStatus;

      if (
        fee.paymentType === "admission" ||
        fee.paymentType === "admissionOnHold"
      ) {
        // ✅ ADMISSION: Always paid with 0 remaining
        remaining = 0;
        newStatus = "paid";
      } else {
        // ✅ MONTHLY: Calculate normally
        const totalPaid = students.reduce(
          (sum, s) => sum + (s.subtotal || 0),
          0
        );
        remaining = Math.max(0, (fee.expectedTotal || 0) - totalPaid);
        newStatus =
          remaining <= 0 ? "paid" : totalPaid > 0 ? "partial" : "unpaid";
      }

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
