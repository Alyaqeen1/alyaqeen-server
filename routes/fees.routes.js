const express = require("express");
const { ObjectId } = require("mongodb");
const sendEmailViaAPI = require("../config/sendAdmissionEmail");
const sendHoldEmail = require("../config/sendHoldEmail");
const router = express.Router();

module.exports = (feesCollection, studentsCollection, familiesCollection) => {
  router.get("/", async (req, res) => {
    const result = await feesCollection.find().toArray();
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

      // 6. Send Email based on type
      if (paymentType === "admissionOnHold") {
        await sendHoldEmail({
          to: familyEmail,
          parentName: familyName,
          studentNames: allStudents.map((s) => s.name),
          method,
        });
      } else if (paymentType === "admission") {
        const enrichedStudents = allStudents.map((student) => {
          const feeInfo = feesData.students.find(
            (s) => String(s.studentId) === String(student._id)
          );

          return {
            ...student,
            admissionFee: feeInfo?.admissionFee || 0,
            monthly_fee: feeInfo?.monthlyFee || 0,
          };
        });

        await sendEmailViaAPI({
          to: familyEmail,
          parentName: familyName,
          students: enrichedStudents,
          totalAmount: amount,
          method,
        });
      } else {
        console.log(
          "✅ Payment saved, but no email sent for type:",
          paymentType
        );
      }

      res.send(result);
    } catch (err) {
      console.error("❌ Error in /fees route:", err);
      res.status(500).send({ message: "Internal server error" });
    }
  });

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

  router.post("/monthly-fees", async (req, res) => {
    const feesData = req.body;
    const { familyId, amount, fee_month, fee_year } = feesData;

    const family = await familiesCollection.findOne({
      _id: new ObjectId(familyId),
    });

    if (!family) return res.status(404).send({ message: "Family not found" });

    const childrenUids = family.children || [];
    const students = await studentsCollection
      .find({ uid: { $in: childrenUids } })
      .toArray();

    const monthIndex = new Date(`${fee_month} 1, ${fee_year}`).getMonth();

    for (const student of students) {
      const joiningDate = new Date(student.startingDate); // stored as ISO
      const joiningMonthIndex = joiningDate.getMonth();
      const joiningYear = joiningDate.getFullYear();

      // Skip months before joining month
      if (
        fee_year < joiningYear ||
        (fee_year === joiningYear && monthIndex < joiningMonthIndex)
      ) {
        return res.status(400).send({
          message: `Cannot pay fee for ${fee_month} ${fee_year} before joining month.`,
        });
      }

      // 1. Check if selected month is already paid
      const alreadyPaid = await feesCollection.findOne({
        familyId,
        fee_month,
        fee_year,
      });
      if (alreadyPaid) {
        return res.status(409).send({
          message: `Fee already paid for ${fee_month} ${fee_year}.`,
        });
      }

      // 2. Check for previous unpaid months since joining
      const allPaidMonths = await feesCollection.find({ familyId }).toArray();

      const paidMonthYearPairs = new Set(
        allPaidMonths.map((f) => `${f.fee_month}-${f.fee_year}`)
      );

      let tempDate = new Date(joiningDate);
      const currentMonthDate = new Date(`${fee_month} 1, ${fee_year}`);

      while (
        tempDate < currentMonthDate &&
        (tempDate.getFullYear() < fee_year ||
          (tempDate.getFullYear() === fee_year &&
            tempDate.getMonth() < monthIndex))
      ) {
        const key = `${tempDate.toLocaleString("default", {
          month: "long",
        })}-${tempDate.getFullYear()}`;

        if (!paidMonthYearPairs.has(key)) {
          return res.status(400).send({
            message: `Unpaid month exists: ${key}. Please pay that first.`,
          });
        }

        tempDate.setMonth(tempDate.getMonth() + 1);
      }
    }

    const result = await feesCollection.insertOne(feesData);
    res.send(result);
  });

  return router;
};
