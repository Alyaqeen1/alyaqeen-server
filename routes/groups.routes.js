const express = require("express");
const router = express.Router();

module.exports = (groupsCollection) => {
  router.get("/", async (req, res) => {
    const result = await groupsCollection.find().toArray();
    res.send(result);
  });

  router.post("/", async (req, res) => {
    const newGroup = req.body;
    const result = await groupsCollection.insertOne(newGroup);
    res.send(result);
  });

  router.get("/find-one", async (req, res) => {
    const { dept_id, class_id, session, time } = req.query;

    try {
      const group = await groupsCollection.findOne({
        dept_id,
        class_id,
        session,
        time,
      });

      if (!group) return res.status(404).send({ message: "Group not found" });

      res.send(group);
    } catch (error) {
      res.status(500).send({ error: "Failed to fetch group" });
    }
  });

  return router;
};
