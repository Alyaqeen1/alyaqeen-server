const express = require("express");
const { ObjectId } = require("mongodb");
const router = express.Router();

module.exports = (holidaysCollection) => {
  router.get("/", async (req, res) => {
    const result = await holidaysCollection.find().toArray();
    res.send(result);
  });

  router.post("/", async (req, res) => {
    const { title, date, description } = req.body;

    try {
      // Check if a holiday with the same date already exists
      const existingHoliday = await holidaysCollection.findOne({ date });

      if (existingHoliday) {
        return res
          .status(200)
          .send({ message: "A holiday on this date already exists" });
      }

      // Prepare new holiday object
      const newHoliday = {
        title,
        date,
        description: description || "", // optional
        createdAt: new Date(),
      };

      const result = await holidaysCollection.insertOne(newHoliday);
      res.send(result);
    } catch (error) {
      res.status(500).send({ message: "Error adding holiday" });
    }
  });

  router.delete("/:id", async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await holidaysCollection.deleteOne(query);
    res.send(result);
  });

  return router;
};
