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
  // Add this route to your existing fees routes
  router.get("/student-summary/:studentId", async (req, res) => {
    try {
      const { studentId } = req.params;

      if (!studentId) {
        return res.status(400).send({ message: "Student ID is required" });
      }

      // 1. Get student details
      const student = await studentsCollection.findOne({
        _id: new ObjectId(studentId),
      });

      if (!student) {
        return res.status(404).send({ message: "Student not found" });
      }

      // 2. Get all monthly fees for this student
      const allFees = await feesCollection
        .find({
          "students.studentId": studentId,
          paymentType: { $in: ["monthly", "monthlyOnHold"] },
        })
        .toArray();

      // 3. Total Paid Monthly (all paid months)
      let totalPaid = 0;
      allFees.forEach((fee) => {
        fee.students.forEach((s) => {
          if (s.studentId === studentId && Array.isArray(s.monthsPaid)) {
            s.monthsPaid.forEach((mp) => {
              totalPaid +=
                mp.discountedFee > 0 ? mp.discountedFee : mp.monthlyFee;
            });
          }
        });
      });

      // 4. Use getUnpaidFees to calculate unpaid months
      const unpaidData = getUnpaidFees({
        students: [student],
        fees: allFees,
        feeChoice: "standard",
        discount: 0,
      });

      // 5. Filter unpaid months from September 2025 onward
      const filterFromMonth = new Date("2025-09-01");
      let unpaidMonthly = 0;
      let outstandingBalance = 0;

      unpaidData.forEach((monthObj) => {
        const monthDate = new Date(`${monthObj.month}-01`);
        if (monthDate >= filterFromMonth) {
          monthObj.students.forEach((stu) => {
            if (stu.studentId === studentId) {
              unpaidMonthly += stu.monthsUnpaid.length;
              outstandingBalance += stu.subtotal;
            }
          });
        }
      });

      // 6. Send simplified summary
      res.send({
        studentId,
        studentName: student.name,
        totalPaidMonthly: parseFloat(totalPaid.toFixed(2)),
        unpaidMonthly,
        outstandingBalance: parseFloat(outstandingBalance.toFixed(2)),
      });
    } catch (error) {
      console.error("Error in student fee summary:", error);
      res.status(500).send({ message: "Internal server error" });
    }
  });

  // You'll also need to include the getUnpaidFees function in this file
  function getUnpaidFees({ students, fees, feeChoice, discount = 0 }) {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const currentDate = now.getDate();
    const cutoffDay = 10;
    const cutoffDay2 = 1;

    const earliestYear = 2025;
    const earliestMonth = 9;

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

          if (fee?.month) {
            const paidMonth = fee.month;
            if (studentId && paidMonth) {
              monthlyPaidMap[`${studentId}_${paidMonth}`] = true;
            }
          }

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

      const startDate = new Date(startingDate);
      if (!studentId || !isValid(startDate)) continue;

      const joinDay = startDate.getDate();
      const fee = monthly_fee || 0;

      const addUnpaidMonth = (monthStr) => {
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

      if (feeChoice === "fullMonth" && joinDay > cutoffDay) {
        let billingEndDate = addDays(startDate, 30);
        while (isBefore(billingEndDate, now)) {
          const monthStr = format(billingEndDate, "yyyy-MM");
          addUnpaidMonth(monthStr);
          billingEndDate = addDays(billingEndDate, 30);
        }
      } else {
        let payableMonth = startDate.getMonth() + 2;
        let payableYear = startDate.getFullYear();
        if (payableMonth > 12) {
          payableMonth = 1;
          payableYear++;
        }

        while (
          payableYear < currentYear ||
          (payableYear === currentYear && payableMonth <= currentMonth)
        ) {
          if (
            payableYear < earliestYear ||
            (payableYear === earliestYear && payableMonth < earliestMonth)
          ) {
            payableMonth++;
            if (payableMonth > 12) {
              payableMonth = 1;
              payableYear++;
            }
            continue;
          }

          const skipCurrentMonth =
            payableYear === currentYear &&
            payableMonth === currentMonth &&
            currentDate < cutoffDay2;

          if (!skipCurrentMonth) {
            const monthStr = `${payableYear}-${payableMonth
              .toString()
              .padStart(2, "0")}`;
            addUnpaidMonth(monthStr);
          }

          payableMonth++;
          if (payableMonth > 12) {
            payableMonth = 1;
            payableYear++;
          }
        }
      }
    }

    return Object.entries(grouped).map(([month, data]) => {
      return {
        month,
        totalAmount: parseFloat(data.totalAmount.toFixed(2)),
        studentNames: Array.from(data.studentNames).join(", "),
        students: Object.values(data.studentsMap).map((stu) => ({
          ...stu,
          subtotal: parseFloat(stu.subtotal.toFixed(2)),
        })),
      };
    });
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

  // delete
  router.delete("/:id", async (req, res) => {
    const { id } = req.params;
    const query = { _id: new ObjectId(id) };
    const result = await feesCollection.deleteOne(query);
    res.send(result);
  });

  return router;
};
