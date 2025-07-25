const express = require("express");
const { ObjectId } = require("mongodb");
const sendEmailViaAPI = require("../config/sendAdmissionEmail");
const sendHoldEmail = require("../config/sendHoldEmail");
const sendMonthlyFeeEmail = require("../config/sendMonthlyFeeEmail");
const router = express.Router();

const enrichStudents = async (
  feeStudents,
  studentsCollection,
  departmentsCollection,
  classesCollection
) => {
  // Get all student records
  const studentIds = feeStudents.map((s) => new ObjectId(s.studentId));
  const allStudents = await studentsCollection
    .find({
      _id: { $in: studentIds },
    })
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
        // const enrichedStudents = allStudents.map((student) => {
        //   const feeInfo = feesData.students.find(
        //     (s) => String(s.studentId) === String(student._id)
        //   );

        //   return {
        //     ...student,
        //     admissionFee: feeInfo?.admissionFee || 0,
        //     monthly_fee: feeInfo?.monthlyFee || 0,
        //   };
        // });
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
  // status pending and paymentType admission on hold
  // router.get("/by-status/:status", async (req, res) => {
  //   const status = req.params.status;
  //   const query = {status}
  //   const result = await feesCollection.find(query).toArray();
  //   res.send(result);
  // });

  // const monthOrder = {
  //   January: 0,
  //   February: 1,
  //   March: 2,
  //   April: 3,
  //   May: 4,
  //   June: 5,
  //   July: 6,
  //   August: 7,
  //   September: 8,
  //   October: 9,
  //   November: 10,
  //   December: 11,
  // };

  // router.post("/monthly-fees", async (req, res) => {
  //   const feesData = req.body;
  //   const { familyId, amount, fee_month, fee_year } = feesData;

  //   const family = await familiesCollection.findOne({
  //     _id: new ObjectId(familyId),
  //   });

  //   if (!family) return res.status(404).send({ message: "Family not found" });

  //   const childrenUids = family.children || [];
  //   const students = await studentsCollection
  //     .find({ uid: { $in: childrenUids } })
  //     .toArray();

  //   const monthIndex = new Date(`${fee_month} 1, ${fee_year}`).getMonth();

  //   for (const student of students) {
  //     const joiningDate = new Date(student.startingDate); // stored as ISO
  //     const joiningMonthIndex = joiningDate.getMonth();
  //     const joiningYear = joiningDate.getFullYear();

  //     // Skip months before joining month
  //     if (
  //       fee_year < joiningYear ||
  //       (fee_year === joiningYear && monthIndex < joiningMonthIndex)
  //     ) {
  //       return res.status(400).send({
  //         message: `Cannot pay fee for ${fee_month} ${fee_year} before joining month.`,
  //       });
  //     }

  //     // 1. Check if selected month is already paid
  //     const alreadyPaid = await feesCollection.findOne({
  //       familyId,
  //       fee_month,
  //       fee_year,
  //     });
  //     if (alreadyPaid) {
  //       return res.status(409).send({
  //         message: `Fee already paid for ${fee_month} ${fee_year}.`,
  //       });
  //     }

  //     // 2. Check for previous unpaid months since joining
  //     const allPaidMonths = await feesCollection.find({ familyId }).toArray();

  //     const paidMonthYearPairs = new Set(
  //       allPaidMonths.map((f) => `${f.fee_month}-${f.fee_year}`)
  //     );

  //     let tempDate = new Date(joiningDate);
  //     const currentMonthDate = new Date(`${fee_month} 1, ${fee_year}`);

  //     while (
  //       tempDate < currentMonthDate &&
  //       (tempDate.getFullYear() < fee_year ||
  //         (tempDate.getFullYear() === fee_year &&
  //           tempDate.getMonth() < monthIndex))
  //     ) {
  //       const key = `${tempDate.toLocaleString("default", {
  //         month: "long",
  //       })}-${tempDate.getFullYear()}`;

  //       if (!paidMonthYearPairs.has(key)) {
  //         return res.status(400).send({
  //           message: `Unpaid month exists: ${key}. Please pay that first.`,
  //         });
  //       }

  //       tempDate.setMonth(tempDate.getMonth() + 1);
  //     }
  //   }

  //   const result = await feesCollection.insertOne(feesData);
  //   res.send(result);
  // });

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

  // router.patch("/update-status-mode/:id", async (req, res) => {
  //   const { id } = req.params;
  //   const { status, paymentType } = req.body;

  //   if (!id || !status) {
  //     return res
  //       .status(400)
  //       .json({ error: "Missing required fields (id or status)" });
  //   }

  //   try {
  //     const fee = await feesCollection.findOne({ _id: new ObjectId(id) });

  //     if (!fee) {
  //       return res.status(404).json({ error: "Fee document not found" });
  //     }

  //     const update = {
  //       status,
  //       paymentType,
  //     };

  //     // // If paymentType is admissionOnHold and admin marks as paid, convert it to admission
  //     // if (fee.paymentType === "admissionOnHold") {
  //     //   update.paymentType = "admission";
  //     // } else if (paymentType) {
  //     //   // In other cases, update paymentType only if provided
  //     //   update.paymentType = paymentType;
  //     // }

  //     const result = await feesCollection.updateOne(
  //       { _id: new ObjectId(id) },
  //       { $set: update }
  //     );

  //     res.send(result);
  //   } catch (err) {
  //     res.status(500).json({ error: "Server error" });
  //   }
  // });
  // delete
  router.delete("/:id", async (req, res) => {
    const { id } = req.params;
    const query = { _id: new ObjectId(id) };
    const result = await feesCollection.deleteOne(query);
    res.send(result);
  });

  return router;
};
