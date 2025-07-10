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

    if (!month || !date || !updates || typeof updates !== "object") {
      return res
        .status(400)
        .send({ error: "month, date and updates are required." });
    }

    // Dynamically build the $set object
    const setFields = {};
    for (const [key, value] of Object.entries(updates)) {
      setFields[`${month}.$[elem].${key}`] = value;
    }

    try {
      const result = await prayerTimesCollection.updateOne(
        {}, // Match the only prayer time document
        { $set: setFields },
        { arrayFilters: [{ "elem.date": date }] }
      );

      if (result.modifiedCount === 0) {
        return res
          .status(404)
          .send({ message: "No matching date found to update." });
      }

      res.send({ message: "Prayer time updated", result });
    } catch (err) {
      console.error(err);
      res.status(500).send({ error: "Failed to update prayer time." });
    }
  });

  return router;
};
