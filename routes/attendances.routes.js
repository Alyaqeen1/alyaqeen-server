const express = require("express");
const { ObjectId } = require("mongodb");
const router = express.Router();

module.exports = (attendancesCollection) => {
  router.get("/", async (req, res) => {
    const result = await attendancesCollection.find().toArray();
    res.send(result);
  });

  router.post("/", async (req, res) => {
    const newAttendance = req.body;
    const result = await attendancesCollection.insertOne(newAttendance);
    res.send(result);
  });

  router.get("/teacher/:teacherId/date/:date", async (req, res) => {
    try {
      const { teacherId, date } = req.params;

      const result = await attendancesCollection.findOne({
        staff_id: teacherId, // ✅ string instead of ObjectId
        date: date,
      });
      res.send(result || null);
    } catch (err) {
      console.error("Error in GET attendance by teacher & date:", err);
      res.status(500).send({ message: "Error fetching attendance record" });
    }
  });

  router.patch("/:id", async (req, res) => {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid teacher ID format" });
    }
    const query = { _id: new ObjectId(id) };
    const { status } = req.body;
    const updatedDoc = {
      $set: { status },
    };
    const result = await attendancesCollection.updateOne(query, updatedDoc);
    res.send(result);
  });

  // PATCH time‑out + total_hours
  router.patch("/:id/timeout", async (req, res) => {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid attendance ID format" });
    }

    const query = { _id: new ObjectId(id) };
    const attendance = await attendancesCollection.findOne(query);

    if (!attendance) {
      return res.status(404).send({ message: "Attendance record not found" });
    }

    if (!attendance.time_in) {
      return res.status(400).send({ message: "time_in missing" });
    }

    const now = new Date();
    const time_out = now.toTimeString().split(" ")[0];

    // Parse the time_in (format: "HH:MM:SS")
    const [hoursIn, minutesIn, secondsIn] = attendance.time_in
      .split(":")
      .map(Number);
    const timeInDate = new Date();
    timeInDate.setHours(hoursIn, minutesIn, secondsIn, 0);

    // Calculate difference in milliseconds
    const diffMs = now - timeInDate;

    // Convert to hours, minutes, seconds
    const totalSeconds = Math.floor(diffMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const total_hours = `${hours} : ${minutes} : ${seconds}`;

    const result = await attendancesCollection.updateOne(query, {
      $set: { time_out, total_hours },
    });

    res.send(result);
  });
  router.delete("/:id", async (req, res) => {
    const attendanceId = req.params.id;
    if (!ObjectId.isValid(attendanceId)) {
      return res.status(400).send({ message: "Invalid attendance ID format" });
    }
    const query = { _id: new ObjectId(attendanceId) };

    const result = await attendancesCollection.deleteOne(query);
    res.send(result);
  });

  return router;
};
