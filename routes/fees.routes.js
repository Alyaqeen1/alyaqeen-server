const express = require("express");
const { ObjectId } = require("mongodb");
const sendEmailViaAPI = require("../config/sendAdmissionEmail");
const router = express.Router();

module.exports = (feesCollection, studentsCollection) => {
  router.get("/", async (req, res) => {
    const result = await feesCollection.find().toArray();
    res.send(result);
  });

  router.post("/", async (req, res) => {
    const feesData = req.body;
    const { uid, amount } = feesData;

    // 1. Find the student by ID
    const student = await studentsCollection.findOne({
      _id: new ObjectId(uid),
    });

    if (!student) {
      return res.status(404).send({ message: "Student not found" });
    }

    // 2. Save the fee data (optional: include student info)
    const result = await feesCollection.insertOne({
      ...feesData,
    });

    // 3. Send the email
    await sendEmailViaAPI({
      to: student.email,
      name: student.name,
      amount: amount,
      department: student?.academic?.department,
      session: student?.academic?.session,
      class: student?.academic?.class,
      time: student?.academic?.time,
    });

    res.send(result);
  });

  return router;
};
