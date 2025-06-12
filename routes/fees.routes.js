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
    const { familyId, amount, paymentType, name, email } = feesData;

    try {
      // 1. Save the fee data
      const result = await feesCollection.insertOne({ ...feesData });

      if (paymentType === "admissionOnHold") {
        try {
          // 1. Get the family document
          const family = await familiesCollection.findOne({
            _id: new ObjectId(familyId),
          });

          if (!family || !Array.isArray(family.children)) {
            return res
              .status(404)
              .send({ message: "Family not found or no children in family." });
          }

          const childrenUids = family.children;

          // 2. Fetch approved students
          const approvedStudents = await studentsCollection
            .find({
              uid: { $in: childrenUids },
              status: "approved",
            })
            .toArray();

          // 3. Collect all student names
          const studentNames = approvedStudents.map((student) => student.name);

          if (studentNames.length === 0) {
            return res
              .status(404)
              .send({ message: "No approved students found in this family." });
          }

          // 4. Send one email with all student names
          await sendHoldEmail({
            to: email,
            parentName: name,
            studentNames, // array of names
            method: feesData?.method || "Selected Method",
          });
        } catch (err) {
          console.error("❌ Error sending hold email:", err);
          return res.status(500).send({ message: "Internal server error" });
        }
      } else {
        // Standard paymentType: send confirmation email to one student
        const student = await studentsCollection.findOne({
          _id: new ObjectId(feesData.uid),
        });

        if (!student) {
          return res.status(404).send({ message: "Student not found" });
        }

        await sendEmailViaAPI({
          to: student.email,
          name: student.name,
          amount,
          department: student?.academic?.department,
          session: student?.academic?.session,
          class: student?.academic?.class,
          time: student?.academic?.time,
        });
      }

      // Success response
      res.send(result);
    } catch (err) {
      console.error("❌ Error in fee route:", err);
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
