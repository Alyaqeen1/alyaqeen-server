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

  // Update fee (partial payment or corrections)
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

      // ✅ Add new payment record
      const newPayment = {
        amount: partialAmount,
        method: partialMethod || "Unknown",
        date: partialDate || new Date(),
      };

      // ✅ Update each selected student's monthsPaid
      const students = fee.students.map((s) => {
        if (studentIds.includes(String(s.studentId))) {
          let monthEntry = s.monthsPaid.find(
            (m) =>
              String(m.month) === String(month) &&
              String(m.year) === String(year)
          );

          if (monthEntry) {
            monthEntry.paid += partialAmount / studentIds.length; // split equally
          } else {
            s.monthsPaid.push({
              month,
              year,
              monthlyFee: s.monthlyFee || 50,
              discountedFee: s.discountedFee || s.monthlyFee || 50,
              paid: partialAmount / studentIds.length,
            });
          }

          // Recalc subtotal
          s.subtotal = s.monthsPaid.reduce((sum, m) => sum + (m.paid || 0), 0);
        }
        return s;
      });

      // ✅ Recalculate totals
      const totalPaid = students.reduce((sum, s) => sum + (s.subtotal || 0), 0);
      const remaining = (fee.expectedTotal || 0) - totalPaid;
      const newStatus =
        remaining <= 0
          ? "paid"
          : remaining < (fee.expectedTotal || 0)
          ? "partial"
          : "unpaid";

      // ✅ Update in DB
      const updatedFee = await feesCollection.findOneAndUpdate(
        { _id: new ObjectId(id) },
        {
          $set: { students, remaining, status: newStatus },
          $push: { payments: newPayment },
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
    const { payments } = req.body; // payments: [{ studentId, month, year, amount }]

    if (!payments || !Array.isArray(payments) || payments.length === 0) {
      return res.status(400).send({ message: "Payments array is required" });
    }

    try {
      const fee = await feesCollection.findOne({ _id: new ObjectId(id) });
      if (!fee) return res.status(404).send({ message: "Fee not found" });

      const students = fee.students.map((s) => {
        const studentPayments = payments.filter(
          (p) => String(p.studentId) === String(s.studentId)
        );

        studentPayments.forEach((p) => {
          // Update the month entry in student
          let monthEntry = s.monthsPaid.find(
            (m) =>
              String(m.month) === String(p.month) &&
              String(m.year) === String(p.year)
          );

          if (monthEntry) {
            monthEntry.paid = p.amount;
          }
        });

        // Recalculate subtotal
        s.subtotal = s.monthsPaid.reduce((sum, m) => sum + (m.paid || 0), 0);
        return s;
      });

      // Recalculate totals for fee
      const totalPaid = students.reduce((sum, s) => sum + (s.subtotal || 0), 0);
      const remaining = Math.max((fee.expectedTotal || 0) - totalPaid, 0); // NEVER negative
      const newStatus =
        remaining <= 0
          ? "paid"
          : remaining < (fee.expectedTotal || 0)
          ? "partial"
          : "unpaid";

      // Update first element of payments array ONLY
      if (fee.payments && fee.payments.length > 0) {
        fee.payments[0].amount = payments[0].amount;
      }

      const updatedFee = await feesCollection.findOneAndUpdate(
        { _id: new ObjectId(id) },
        {
          $set: {
            students,
            remaining,
            status: newStatus,
            payments: fee.payments,
          },
        },
        { returnDocument: "after" }
      );

      res.send({ message: "Payment updated successfully", updatedFee });
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
