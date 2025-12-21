const express = require("express");
const router = express.Router();

module.exports = (prayerTimesCollection) => {
  // GET all prayer times
  router.get("/", async (req, res) => {
    try {
      const result = await prayerTimesCollection.find().toArray();
      res.send(result);
    } catch (err) {
      res.status(500).send({ error: "Failed to fetch prayer times" });
    }
  });

  // PATCH to update specific prayer fields
  router.put("/update", async (req, res) => {
    const { month, date, updates } = req.body;

    try {
      if (!month || !date || !updates || typeof updates !== "object") {
        return res
          .status(400)
          .send({ error: "month, date and updates are required." });
      }

      // First, find the document
      const prayerTimesDoc = await prayerTimesCollection.findOne({});

      if (!prayerTimesDoc) {
        return res
          .status(404)
          .send({ message: "Prayer times document not found." });
      }

      // Find the specific day in the month array
      const monthArray = prayerTimesDoc[month];
      if (!monthArray) {
        return res.status(404).send({ message: `Month '${month}' not found.` });
      }

      const dayIndex = monthArray.findIndex((d) => d.date === Number(date));
      if (dayIndex === -1) {
        return res
          .status(404)
          .send({ message: `Date ${date} not found in ${month}.` });
      }

      // Build update object for daily prayers
      const updateObj = {};
      for (const [key, value] of Object.entries(updates)) {
        if (key.includes(".")) {
          // Handle nested fields like "fajr.start"
          const keys = key.split(".");
          let updatePath = `${month}.${dayIndex}`;
          for (const k of keys) {
            updatePath += `.${k}`;
          }
          updateObj[updatePath] = value;
        } else {
          // Handle top-level fields like "sunrise"
          updateObj[`${month}.${dayIndex}.${key}`] = value;
        }
      }

      // ALWAYS include Jumu'ah updates from the request
      if (
        updates.jumuahSummer1 ||
        updates.jumuahSummer2 ||
        updates.jumuahSummer3 ||
        updates.jumuahWinter1 ||
        updates.jumuahWinter2 ||
        updates.jumuahWinter3
      ) {
        // Add Jumu'ah updates if they exist in the request
        if (updates.jumuahSummer1)
          updateObj["jumuah.summer.first"] = updates.jumuahSummer1;
        if (updates.jumuahSummer2)
          updateObj["jumuah.summer.second"] = updates.jumuahSummer2;
        if (updates.jumuahSummer3)
          updateObj["jumuah.summer.third"] = updates.jumuahSummer3;
        if (updates.jumuahWinter1)
          updateObj["jumuah.winter.first"] = updates.jumuahWinter1;
        if (updates.jumuahWinter2)
          updateObj["jumuah.winter.second"] = updates.jumuahWinter2;
        if (updates.jumuahWinter3)
          updateObj["jumuah.winter.third"] = updates.jumuahWinter3;
      }

      const result = await prayerTimesCollection.updateOne(
        { _id: prayerTimesDoc._id },
        { $set: updateObj }
      );

      if (result.modifiedCount === 0) {
        return res
          .status(404)
          .send({ message: "No matching date found to update." });
      }

      res.send({ message: "Prayer time updated", result });
    } catch (err) {
      console.error("Update error:", err);
      res.status(500).send({ error: "Failed to update prayer time." });
    }
  });

  return router;
};
