const express = require("express");
const router = express.Router();

module.exports = (familiesCollection, studentsCollection) => {
  router.get("/", async (req, res) => {
    const result = await familiesCollection.find().toArray();
    res.send(result);
  });

  router.get("/:email", async (req, res) => {
    const email = req.params.email;
    const query = { email };
    const result = await familiesCollection.findOne(query);
    res.send(result);
  });

  router.post("/", async (req, res) => {
    const family = req.body;
    const result = await familiesCollection.insertOne(family);
    res.send(result);
  });

  router.patch("/:email/add-child", async (req, res) => {
    const email = req.params.email;
    const { studentUid } = req.body;

    const result = await familiesCollection.updateOne(
      { email },
      { $addToSet: { children: studentUid } } // prevents duplicates
    );

    res.send(result);
  });

  router.get("/:email/with-children", async (req, res) => {
    const email = req.params.email;

    try {
      const result = await familiesCollection
        .aggregate([
          { $match: { email } },
          {
            $lookup: {
              from: studentsCollection.collectionName, // actual collection name
              let: { childUids: "$children" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $in: ["$uid", "$$childUids"] },
                        { $eq: ["$status", "approved"] }, // filter only approved
                      ],
                    },
                  },
                },
              ],
              as: "childrenDocs",
            },
          },
          {
            $project: {
              name: 1,
              email: 1,
              children: 1,
              childrenDocs: 1,
              feeChoice: 1,
            },
          },
        ])
        .toArray();

      if (result.length === 0) {
        return res.status(404).send({ message: "Family not found" });
      }

      res.send(result[0]);
    } catch (err) {
      console.error(err);
      res.status(500).send({ error: "Server error" });
    }
  });

  router.get("/:email/with-children/all", async (req, res) => {
    const email = req.params.email;

    try {
      const result = await familiesCollection
        .aggregate([
          { $match: { email } },
          {
            $lookup: {
              from: studentsCollection.collectionName, // get the actual collection name string
              localField: "children",
              foreignField: "uid",
              as: "childrenDocs",
            },
          },
          {
            $project: {
              name: 1,
              email: 1,
              children: 1,
              childrenDocs: 1,
              feeChoice: 1,
            },
          },
        ])
        .toArray();

      if (result.length === 0) {
        return res.status(404).send({ message: "Family not found" });
      }

      res.send(result[0]);
    } catch (err) {
      console.error(err);
      res.status(500).send({ error: "Server error" });
    }
  });

  router.patch("/:email/update-fee-choice", async (req, res) => {
    const email = req.params.email;
    const { feeChoice } = req.body;

    try {
      const result = await familiesCollection.updateOne(
        { email },
        { $set: { feeChoice } }
      );
      res.send(result);
    } catch (err) {
      console.error(err);
      res.status(500).send({ error: "Server error" });
    }
  });

  return router;
};
