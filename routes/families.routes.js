const express = require("express");
const { ObjectId } = require("mongodb");
const studentEnrichmentStages = require("../config/studentEnrichmentStages");
const router = express.Router();

module.exports = (familiesCollection, studentsCollection, feesCollection) => {
  router.get("/", async (req, res) => {
    const result = await familiesCollection.find().toArray();
    res.send(result);
  });

  router.get("/:id", async (req, res) => {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ error: "Invalid ID format" });
    }
    const query = { _id: new ObjectId(id) };

    const result = await familiesCollection.findOne(query);
    res.send(result);
  });

  router.get("/by-email/:email", async (req, res) => {
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

  // students who are enrolled or hold with family

  router.get("/with-children/enrolled", async (req, res) => {
    try {
      const result = await familiesCollection
        .aggregate([
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
                        // { $eq: ["$status", "enrolled"] }, // filter only approved
                        { $in: ["$status", ["enrolled", "hold"]] }, // filter for enrolled or hold
                        { $eq: ["$activity", "active"] },
                      ],
                    },
                  },
                },
                ...studentEnrichmentStages(),
              ],
              as: "childrenDocs",
            },
          },
          // {
          //   $project: {
          //     name: 1,
          //     email: 1,
          //     children: 1,
          //     childrenDocs: 1,
          //     feeChoice: 1,
          //   },
          // },
        ])
        .toArray();

      // Optional: Sanitize the data to remove any potential circular references
      // const sanitizedResult = result.map((family) => ({
      //   ...family,
      //   childrenDocs: family.childrenDocs.map((child) => ({
      //     // explicitly list the fields you want to include
      //     uid: child.uid,
      //     name: child.name,
      //     status: child.status,
      //     // etc.
      //   })),
      // }));

      res.send(result);
    } catch (err) {
      res.status(500).send({ error: "Server error" });
    }
  });
  // students who are hold with family

  router.get("/with-children/hold", async (req, res) => {
    try {
      const result = await familiesCollection
        .aggregate([
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
                        // { $eq: ["$status", "enrolled"] }, // filter only approved
                        { $in: ["$status", ["hold"]] }, // filter for enrolled or hold
                        { $eq: ["$activity", "active"] }, // filter for enrolled or hold
                      ],
                    },
                  },
                },
              ],
              as: "childrenDocs",
            },
          },
          // {
          //   $project: {
          //     name: 1,
          //     email: 1,
          //     children: 1,
          //     childrenDocs: 1,
          //     feeChoice: 1,
          //   },
          // },
        ])
        .toArray();

      // Optional: Sanitize the data to remove any potential circular references
      // const sanitizedResult = result.map((family) => ({
      //   ...family,
      //   childrenDocs: family.childrenDocs.map((child) => ({
      //     // explicitly list the fields you want to include
      //     uid: child.uid,
      //     name: child.name,
      //     status: child.status,
      //     // etc.
      //   })),
      // }));

      res.send(result);
    } catch (err) {
      res.status(500).send({ error: "Server error" });
    }
  });
  // student who is approved with family
  router.get("/with-children/approved/:email", async (req, res) => {
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
                ...studentEnrichmentStages(),
              ],
              as: "childrenDocs",
            },
          },
          // {
          //   $project: {
          //     name: 1,
          //     email: 1,
          //     children: 1,
          //     childrenDocs: 1,
          //     feeChoice: 1,
          //   },
          // },
        ])
        .toArray();

      if (result.length === 0) {
        return res.status(200).send({ message: "Family not found" });
      }

      res.send(result[0]);
    } catch (err) {
      res.status(500).send({ error: "Server error" });
    }
  });
  // student who is enrolled with family
  router.get("/with-children/enrolled/:email", async (req, res) => {
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
                        { $eq: ["$status", "enrolled"] }, // filter only approved
                      ],
                    },
                  },
                },
                ...studentEnrichmentStages(),
              ],
              as: "childrenDocs",
            },
          },
          // {
          //   $project: {
          //     name: 1,
          //     email: 1,
          //     children: 1,
          //     childrenDocs: 1,
          //     feeChoice: 1,
          //   },
          // },
        ])
        .toArray();

      if (result.length === 0) {
        return res.status(200).send({ message: "Family not found" });
      }

      res.send(result[0]);
    } catch (err) {
      res.status(500).send({ error: "Server error" });
    }
  });
  // student with family
  router.get("/with-children/all/:email", async (req, res) => {
    const email = req.params.email;

    try {
      const result = await familiesCollection
        .aggregate([
          { $match: { email } },
          {
            $lookup: {
              from: studentsCollection.collectionName,
              let: { childUids: "$children" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $in: ["$uid", "$$childUids"],
                    },
                  },
                },
                ...studentEnrichmentStages(),
              ],
              as: "childrenDocs",
            },
          },

          // {
          //   $project: {
          //     name: 1,
          //     email: 1,
          //     children: 1,
          //     childrenDocs: 1,
          //     feeChoice: 1,
          //   },
          // },
        ])
        .toArray();

      if (result.length === 0) {
        return res.status(200).send({ message: "Family not found" });
      }

      res.send(result[0]);
    } catch (err) {
      res.status(500).send({ error: "Server error" });
    }
  });

  router.patch("/update-fee-choice/:email", async (req, res) => {
    const email = req.params.email;
    const { feeChoice } = req.body;

    try {
      const result = await familiesCollection.updateOne(
        { email },
        { $set: { feeChoice } }
      );
      res.send(result);
    } catch (err) {
      res.status(500).send({ error: "Server error" });
    }
  });
  // Delete family
  router.delete("/:id", async (req, res) => {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ error: "Invalid ID format" });
    }
    const query = { _id: new ObjectId(id) };

    const result = await familiesCollection.deleteOne(query);
    res.send(result);
  });
  // update family

  router.patch("/update-by-admin/:id", async (req, res) => {
    try {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ error: "Invalid ID format" });
      }
      const query = { _id: new ObjectId(id) };

      const { name, children, discount, newlyAddedChildren = [] } = req.body;

      if (!Array.isArray(children)) {
        return res.status(400).json({ error: "Invalid children array" });
      }

      const updatedDoc = {
        $set: {
          name,
          discount: Number(discount) || 0,
          children,
          updatedAt: new Date(),
        },
      };

      const familyResult = await familiesCollection.updateOne(
        query,
        updatedDoc
      );

      // ✅ Only update newly added students to "enrolled"
      if (newlyAddedChildren.length > 0) {
        await studentsCollection.updateMany(
          { uid: { $in: newlyAddedChildren } },
          { $set: { status: "enrolled" } }
        );
      }

      res.send({ success: true, modifiedCount: familyResult.modifiedCount });
    } catch (error) {
      res.status(500).send({ error: "Failed to update family" });
    }
  });
  router.get("/with-children/enrolled-fee-summary", async (req, res) => {
    try {
      const result = await familiesCollection
        .aggregate([
          // 1. Convert _id (ObjectId) to string for matching
          {
            $addFields: {
              familyIdString: { $toString: "$_id" }, // Convert ObjectId to string
            },
          },
          // 2. Lookup student documents for the children array
          {
            $lookup: {
              from: studentsCollection.collectionName,
              let: { childUids: "$children" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $in: ["$uid", "$$childUids"] },
                        { $in: ["$status", ["enrolled", "hold"]] },
                        { $eq: ["$activity", "active"] },
                      ],
                    },
                  },
                },
                ...studentEnrichmentStages(),
              ],
              as: "childrenDocs",
            },
          },
          // 3. Lookup fees using the string version of familyId
          {
            $lookup: {
              from: feesCollection.collectionName,
              localField: "familyIdString", // Use the converted string
              foreignField: "familyId", // This is a string in feesCollection
              as: "feePayments",
            },
          },
          // 4. Calculate total paid and pending amounts
          {
            $addFields: {
              totalPaidAmount: {
                $sum: {
                  $map: {
                    input: {
                      $filter: {
                        input: "$feePayments",
                        as: "fee",
                        cond: { $eq: ["$$fee.status", "paid"] },
                      },
                    },
                    as: "paidFee",
                    in: "$$paidFee.amount",
                  },
                },
              },
              totalPendingAmount: {
                $sum: {
                  $map: {
                    input: {
                      $filter: {
                        input: "$feePayments",
                        as: "fee",
                        cond: { $ne: ["$$fee.status", "paid"] },
                      },
                    },
                    as: "pendingFee",
                    in: "$$pendingFee.amount",
                  },
                },
              },
            },
          },
          // 5. (Optional) Remove the temporary field
          { $unset: "familyIdString" },
        ])
        .toArray();

      res.send(result);
    } catch (err) {
      res.status(500).send({ error: "Server error" });
    }
  });
  router.get("/with-children/enrolled/by-id/:id", async (req, res) => {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ error: "Invalid ID format" });
    }

    try {
      const result = await familiesCollection
        .aggregate([
          { $match: { _id: new ObjectId(id) } },
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
                        { $eq: ["$status", "enrolled"] }, // filter only approved
                      ],
                    },
                  },
                },
                ...studentEnrichmentStages(),
              ],
              as: "childrenDocs",
            },
          },
          // {
          //   $project: {
          //     name: 1,
          //     email: 1,
          //     children: 1,
          //     childrenDocs: 1,
          //     feeChoice: 1,
          //   },
          // },
        ])
        .toArray();

      if (result.length === 0) {
        return res.status(200).send({ message: "Family not found" });
      }

      res.send(result[0]);
    } catch (err) {
      res.status(500).send({ error: "Server error" });
    }
  });

  return router;
};
