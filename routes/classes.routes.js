const express = require("express");
const { ObjectId } = require("mongodb");
const router = express.Router();

module.exports = (classesCollection) => {
  router.get("/", async (req, res) => {
    const result = await classesCollection.find().toArray();

    // Custom sorting function that handles alphanumeric parts
    const compareClassNames = (a, b) => {
      // Extract the main part of the class name (before any hyphen)
      const nameA = a.class_name.split(" - ")[0];
      const nameB = b.class_name.split(" - ")[0];

      // First compare alphabetically
      if (nameA < nameB) return -1;
      if (nameA > nameB) return 1;

      // If names are equal, compare the full class name
      return a.class_name.localeCompare(b.class_name);
    };

    // Sort the results
    const sortedResults = result.sort(compareClassNames);

    res.send(sortedResults);
  });
  router.get("/find-one", async (req, res) => {
    const { dept_id, class_id, session, time } = req.query;
    try {
      const classData = await classesCollection.findOne({
        _id: new ObjectId(class_id),
        dept_id,
        session,
        session_time: time,
      });

      if (!classData)
        return res.status(404).send({ message: "Group not found" });

      res.send(classData);
    } catch (error) {
      res.status(500).send({ error: "Failed to fetch class" });
    }
  });
  router.get("/:id", async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await classesCollection.findOne(query);
    res.send(result);
  });

  router.post("/", async (req, res) => {
    const newClass = req.body;
    const result = await classesCollection.insertOne(newClass);
    res.send(result);
  });
  router.delete("/:id", async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await classesCollection.deleteOne(query);
    res.send(result);
  });
  router.put("/:id", async (req, res) => {
    const id = req.params.id;
    const classData = req.body;
    const query = { _id: new ObjectId(id) };
    const updatedDoc = {
      $set: { ...classData },
    };
    const result = await classesCollection.updateOne(query, updatedDoc);
    res.send(result);
  });

  return router;
};
