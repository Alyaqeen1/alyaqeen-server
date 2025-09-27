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

  // Create enriched students
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
      admissionFee: feeInfo?.admissionFee || 0,
      monthly_fee: feeInfo?.monthlyFee || 0,
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

      if (paymentType === "monthly" || paymentType === "monthlyOnHold") {
        await sendMonthlyFeeEmail({
          to: familyEmail,
          parentName: familyName,
          students: feesData.students,
          totalAmount: amount,
          method,
          date: feesData.timestamp,
          isOnHold: paymentType === "monthlyOnHold", // 👈 this decides the message & subject
        });
      }

      // 6. Send Email based on type
      if (paymentType === "admissionOnHold") {
        await sendHoldEmail({
          to: familyEmail,
          parentName: familyName,
          studentNames: allStudents.map((s) => s.name),
          method,
        });
      } else if (paymentType === "admission") {
        const enrichedStudents = await enrichStudents(
          feesData.students,
          studentsCollection,
          departmentsCollection,
          classesCollection
        );

        await sendEmailViaAPI({
          to: familyEmail,
          parentName: familyName,
          students: enrichedStudents,
          totalAmount: amount,
          method,
        });
      } else {
        // "✅ Payment saved, but no email sent for type:",
      }

      res.send(result);
    } catch (err) {
      res.status(500).send({ message: "Internal server error" });
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

      // 2. Get ALL fees for this student (including admission fees that contain first month fee)
      const allFees = await feesCollection
        .find({
          "students.studentId": studentId,
          paymentType: {
            $in: ["monthly", "monthlyOnHold", "admission", "admissionOnHold"],
          },
        })
        .toArray();

      // 3. Extract all paid months for this student (from both monthly and admission fees)
      const paidMonths = new Set();
      let totalMonthlyPaid = 0;
      const monthlyPayments = [];

      allFees.forEach((fee) => {
        fee.students.forEach((feeStudent) => {
          if (feeStudent.studentId === studentId) {
            // Handle monthly fees (with monthsPaid array)
            if (feeStudent.monthsPaid) {
              feeStudent.monthsPaid.forEach((monthPaid) => {
                const monthKey = `${monthPaid.year}-${monthPaid.month
                  .toString()
                  .padStart(2, "0")}`;
                paidMonths.add(monthKey);

                const paymentAmount =
                  monthPaid.discountedFee > 0
                    ? monthPaid.discountedFee
                    : monthPaid.monthlyFee;
                totalMonthlyPaid += paymentAmount;

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
                const monthName =
                  monthNames[parseInt(monthPaid.month) - 1] || monthPaid.month;
                const displayMonth = `${monthName} ${monthPaid.year}`;

                let formattedPaymentDate = "N/A";
                if (fee.date) {
                  const dateParts = fee.date.split("-");
                  if (dateParts.length === 3) {
                    formattedPaymentDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
                  } else {
                    formattedPaymentDate = fee.date;
                  }
                }

                monthlyPayments.push({
                  month: monthKey,
                  displayMonth: displayMonth,
                  amount: paymentAmount,
                  paymentDate: formattedPaymentDate,
                  status: fee.status,
                  paymentType: fee.paymentType,
                  feeId: fee._id,
                  isFirstMonth: false, // Regular monthly payment
                });
              });
            }

            // Handle admission fees (extract first month fee)
            if (
              (fee.paymentType === "admission" ||
                fee.paymentType === "admissionOnHold") &&
              feeStudent.joiningMonth &&
              feeStudent.joiningYear
            ) {
              const monthKey = `${
                feeStudent.joiningYear
              }-${feeStudent.joiningMonth.toString().padStart(2, "0")}`;

              // Only add if this month hasn't been paid already via monthly fee
              if (!paidMonths.has(monthKey)) {
                paidMonths.add(monthKey);

                const monthlyFeeAmount = feeStudent.monthlyFee || 0;
                totalMonthlyPaid += monthlyFeeAmount;

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
                const monthName =
                  monthNames[parseInt(feeStudent.joiningMonth) - 1] ||
                  feeStudent.joiningMonth;
                const displayMonth = `${monthName} ${feeStudent.joiningYear}`;

                let formattedPaymentDate = "N/A";
                if (fee.date) {
                  const dateParts = fee.date.split("-");
                  if (dateParts.length === 3) {
                    formattedPaymentDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
                  } else {
                    formattedPaymentDate = fee.date;
                  }
                }

                monthlyPayments.push({
                  month: monthKey,
                  displayMonth: displayMonth,
                  amount: monthlyFeeAmount,
                  paymentDate: formattedPaymentDate,
                  status: fee.status,
                  paymentType: fee.paymentType,
                  feeId: fee._id,
                  isFirstMonth: true, // Mark as first month from admission
                });
              }
            }
          }
        });
      });

      // 4. Calculate unpaid months using getUnpaidFees (only use monthly fees for this)
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
                outstandingAmount += monthUnpaid.discountedFee;

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
                const monthYear = monthUnpaid.month.split("-");
                const monthName =
                  monthNames[parseInt(monthYear[1]) - 1] || monthYear[1];
                const displayMonth = `${monthName} ${monthYear[0]}`;

                unpaidMonthsDetails.push({
                  month: monthUnpaid.month,
                  displayMonth: displayMonth,
                  monthlyFee: monthUnpaid.monthlyFee,
                  discountedFee: monthUnpaid.discountedFee,
                  status: "unpaid",
                });
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
            if (!paidMonths.has(monthKey)) {
              consecutiveUnpaidMonths++;
            } else {
              break;
            }
          }
          currentMonth.setMonth(currentMonth.getMonth() + 1);
        }
      }

      // 8. Format all payment dates in allPayments array
      const formattedAllPayments = allFees
        .map((fee) => {
          let formattedDate = "N/A";
          if (fee.date) {
            const dateParts = fee.date.split("-");
            if (dateParts.length === 3) {
              formattedDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
            } else {
              formattedDate = fee.date;
            }
          }

          return {
            _id: fee._id,
            amount: fee.amount,
            status: fee.status,
            paymentType: fee.paymentType,
            timestamp: formattedDate,
            studentPortion:
              fee.students.find((s) => s.studentId === studentId)?.subtotal ||
              0,
          };
        })
        .sort((a, b) => {
          const feeA = allFees.find(
            (f) => f._id.toString() === a._id.toString()
          );
          const feeB = allFees.find(
            (f) => f._id.toString() === b._id.toString()
          );
          return (
            new Date(feeB.timestamp || feeB._id.getTimestamp()) -
            new Date(feeA.timestamp || feeA._id.getTimestamp())
          );
        });

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
          })),
        unpaidMonths: unpaidMonthsDetails
          .sort((a, b) => new Date(b.month) - new Date(a.month))
          .map((unpaid) => ({
            month: unpaid.displayMonth,
            monthlyFee: unpaid.monthlyFee,
            discountedFee: unpaid.discountedFee,
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

  // Helper function to format month for display
  function formatDisplayMonth(monthKey) {
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
    const parts = monthKey.split("-");
    const year = parts[0];
    const month = parseInt(parts[1]);
    const monthName = monthNames[month - 1] || month;
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

    try {
      const fee = await feesCollection.findOne({ _id: new ObjectId(id) });
      if (!fee) return res.status(404).send({ message: "Fee not found" });

      // Get family to check for discounts
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

      // ✅ Update students based on payment type
      const students = fee.students.map((s) => {
        if (studentIds.includes(String(s.studentId))) {
          if (
            fee.paymentType === "monthly" ||
            fee.paymentType === "monthlyOnHold"
          ) {
            // Handle monthly payments
            let monthEntry = s.monthsPaid?.find(
              (m) =>
                String(m.month) === String(month) &&
                String(m.year) === String(year)
            );

            if (monthEntry) {
              monthEntry.paid =
                Number(monthEntry.paid || 0) +
                Number(partialAmount) / studentIds.length;
            } else {
              if (!s.monthsPaid) s.monthsPaid = [];

              const baseFee = s.monthlyFee || s.monthly_fee || 50;
              const discountedFee =
                discountPercent > 0
                  ? Number(
                      (baseFee - (baseFee * discountPercent) / 100).toFixed(2)
                    )
                  : Number(baseFee);

              s.monthsPaid.push({
                month,
                year,
                monthlyFee: Number(baseFee),
                discountedFee: Number(discountedFee),
                paid: Number(partialAmount) / studentIds.length,
              });
            }

            // Recalc subtotal for monthly
            s.subtotal =
              s.monthsPaid?.reduce((sum, m) => sum + (m.paid || 0), 0) || 0;
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

      res.send({ message: "Partial payment added", updatedFee });
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
