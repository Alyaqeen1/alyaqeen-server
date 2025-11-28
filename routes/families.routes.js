const express = require("express");
const { ObjectId } = require("mongodb");
const studentEnrichmentStages = require("../config/studentEnrichmentStages");
const router = express.Router();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
module.exports = (familiesCollection, studentsCollection, feesCollection) => {
  router.get("/", async (req, res) => {
    try {
      const result = await familiesCollection
        .find({}, { projection: { _id: 1, children: 1 } }) // <-- correct
        .toArray();
      res.send(result);
    } catch (err) {
      console.error(err);
      res.status(500).send({ message: "Server error" });
    }
  });
  // In your families.routes.js
  router.get("/check-direct-debit-setup", async (req, res) => {
    try {
      const { familyId } = req.query;

      if (!familyId) {
        return res.status(400).json({ error: "Family ID is required" });
      }

      const family = await familiesCollection.findOne({
        _id: new ObjectId(familyId),
      });

      if (!family) {
        return res.status(404).json({ error: "Family not found" });
      }

      // ✅ FIX: Make sure hasDirectDebit is calculated correctly
      const hasDirectDebit =
        family.directDebit &&
        (family.directDebit.status === "active" ||
          family.directDebit.status === "pending");

      res.json({
        hasDirectDebit: hasDirectDebit, // ✅ This must be true for pending status
        directDebit: hasDirectDebit ? family.directDebit : null,
      });
    } catch (error) {
      console.error("Error checking Direct Debit setup:", error);
      res.status(500).json({ error: error.message });
    }
  });
  // ✅ Get Direct Debit families with fee payment data
  router.get("/admin/direct-debit-families-with-fees", async (req, res) => {
    try {
      const result = await familiesCollection
        .aggregate([
          // 1. Only include families with Direct Debit setup
          {
            $match: {
              directDebit: { $exists: true },
            },
          },
          // 2. Convert _id to string for fee matching
          {
            $addFields: {
              familyIdString: { $toString: "$_id" },
            },
          },
          // 3. Lookup student documents
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
                        { $in: ["$status", ["enrolled", "hold", "approved"]] },
                      ],
                    },
                  },
                },
                ...studentEnrichmentStages(),
              ],
              as: "childrenDocs",
            },
          },
          // 4. Lookup fee payments
          {
            $lookup: {
              from: feesCollection.collectionName,
              localField: "familyIdString",
              foreignField: "familyId",
              as: "feePayments",
            },
          },
          // 5. Calculate statistics
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
          {
            $sort: {
              "directDebit.status": 1,
              name: 1,
            },
          },
          // 6. Remove temporary field
          { $unset: "familyIdString" },
        ])
        .toArray();

      // Calculate statistics
      const stats = {
        total: result.length,
        active: result.filter((f) => f.directDebit?.status === "active").length,
        pending: result.filter((f) => f.directDebit?.status === "pending")
          .length,
        cancelled: result.filter((f) => f.directDebit?.status === "cancelled")
          .length,
      };

      res.json({
        success: true,
        count: result.length,
        stats: stats,
        families: result,
      });
    } catch (error) {
      console.error("Admin Direct Debit with fees fetch error:", error);
      res.status(500).json({ error: error.message });
    }
  });
  // ✅ Get specific family Direct Debit details
  // router.get("/admin/direct-debit-family/:id", async (req, res) => {
  //   try {
  //     const { id } = req.params;

  //     if (!ObjectId.isValid(id)) {
  //       return res.status(400).json({ error: "Invalid family ID" });
  //     }

  //     const family = await familiesCollection
  //       .aggregate([
  //         {
  //           $match: { _id: new ObjectId(id) },
  //         },
  //         {
  //           $lookup: {
  //             from: studentsCollection.collectionName,
  //             localField: "children",
  //             foreignField: "uid",
  //             as: "childrenDocs",
  //           },
  //         },
  //         {
  //           $lookup: {
  //             from: feesCollection.collectionName,
  //             let: { familyId: { $toString: "$_id" } },
  //             pipeline: [
  //               {
  //                 $match: {
  //                   $expr: { $eq: ["$familyId", "$$familyId"] },
  //                   status: "paid",
  //                 },
  //               },
  //               { $sort: { paymentDate: -1 } },
  //               { $limit: 5 }, // Last 5 payments
  //             ],
  //             as: "recentPayments",
  //           },
  //         },
  //         {
  //           $project: {
  //             _id: 1,
  //             name: 1,
  //             email: 1,
  //             phone: 1,
  //             fatherName: 1,
  //             discount: 1,
  //             feeChoice: 1,
  //             createdAt: 1,
  //             updatedAt: 1,
  //             "childrenDocs._id": 1,
  //             "childrenDocs.name": 1,
  //             "childrenDocs.status": 1,
  //             "childrenDocs.activity": 1,
  //             "childrenDocs.monthly_fee": 1,
  //             directDebit: 1,
  //             recentPayments: 1,
  //           },
  //         },
  //       ])
  //       .toArray();

  //     if (family.length === 0) {
  //       return res.status(404).json({ error: "Family not found" });
  //     }

  //     res.json({
  //       success: true,
  //       family: family[0],
  //     });
  //   } catch (error) {
  //     console.error("Admin Direct Debit family details error:", error);
  //     res.status(500).json({ error: error.message });
  //   }
  // });

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
                {
                  $match: {
                    activity: "active", // optional: ensure active ones only
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
      const { name, children, discount } = req.body;

      if (!Array.isArray(children)) {
        return res.status(400).json({ error: "Invalid children array" });
      }

      const familyDoc = await familiesCollection.findOne(query);
      if (!familyDoc) {
        return res.status(404).json({ error: "Family not found" });
      }

      const currentChildren = familyDoc.children || [];
      const newlyAddedChildren = children.filter(
        (child) => !currentChildren.includes(child)
      );
      const removedChildren = currentChildren.filter(
        (child) => !children.includes(child)
      );

      // ✅ FIXED: Check if newly added children belong to OTHER families
      if (newlyAddedChildren.length > 0) {
        // Only consider it a conflict if they have a NON-EMPTY parentUid that's DIFFERENT from this family
        const existingStudents = await studentsCollection
          .find({
            uid: { $in: newlyAddedChildren },
            $and: [
              { parentUid: { $exists: true } },
              { parentUid: { $ne: "" } }, // Must have actual parentUid (not empty)
              { parentUid: { $ne: familyDoc.uid } }, // And it's different from this family
            ],
          })
          .toArray();

        if (existingStudents.length > 0) {
          const conflictedStudents = existingStudents.map((student) => ({
            uid: student.uid,
            name: student.name,
            currentFamily: student.family_name,
            parentUid: student.parentUid,
          }));

          return res.status(400).json({
            error: "Some students already belong to other families",
            conflictedStudents: conflictedStudents,
            message: `Please remove the students from their current families first before adding to this family.`,
            details: conflictedStudents.map(
              (student) =>
                `${student.name} is currently in ${
                  student.currentFamily || "another"
                } family`
            ),
          });
        }
      }

      // Update family first
      const familyResult = await familiesCollection.updateOne(query, {
        $set: {
          name,
          discount: Number(discount) || 0,
          children,
          updatedAt: new Date(),
        },
      });

      // Handle removals
      if (removedChildren.length > 0) {
        const removeResult = await studentsCollection.updateMany(
          { uid: { $in: removedChildren } },
          { $set: { email: "", family_name: "", parentUid: "" } }
        );
      }

      // Handle additions
      if (newlyAddedChildren.length > 0) {
        const addResult = await studentsCollection.updateMany(
          { uid: { $in: newlyAddedChildren } },
          {
            $set: {
              email: familyDoc.email,
              family_name: name,
              parentUid: familyDoc.uid,
            },
          }
        );
      }

      res.send({
        success: true,
        modifiedCount: familyResult.modifiedCount,
        addedCount: newlyAddedChildren.length,
        removedCount: removedChildren.length,
        message: `Family updated successfully.`,
      });
    } catch (error) {
      console.log("❌ UPDATE FAILED:", error);
      res.status(500).send({
        error: "Failed to update family",
        details: error.message,
      });
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
                        { $in: ["$status", ["enrolled", "hold", "approved"]] },
                        // { $eq: ["$activity", "active"] },
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
          {
            $sort: { name: 1 },
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
                        {
                          $or: [
                            { $eq: ["$status", "enrolled"] },
                            { $eq: ["$status", "approved"] },
                          ],
                        },
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
  // Add this route to your families.js file
  router.get("/unpaid-families/:month/:year", async (req, res) => {
    try {
      const { month, year } = req.params;

      const monthNum = parseInt(month, 10);
      const yearNum = parseInt(year, 10);

      if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
        return res
          .status(400)
          .send({ error: "Invalid month. Must be between 1-12" });
      }

      if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
        return res.status(400).send({ error: "Invalid year" });
      }

      const targetMonthKey = `${yearNum}-${monthNum
        .toString()
        .padStart(2, "0")}`;

      const families = await familiesCollection
        .aggregate([
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
              ],
              as: "childrenDocs",
            },
          },
          { $match: { "childrenDocs.0": { $exists: true } } },
        ])
        .toArray();

      const familyIds = families.map((f) => f._id.toString());
      const allFamilyFees = await feesCollection
        .find({
          familyId: { $in: familyIds },
          paymentType: {
            $in: ["monthly", "monthlyOnHold", "admission", "admissionOnHold"],
          },
        })
        .toArray();

      const result = [];

      for (const family of families) {
        const familyFees = allFamilyFees.filter(
          (fee) => fee.familyId === family._id.toString()
        );

        const unpaidStudents = [];
        let familyHasUnpaid = false;

        for (const student of family.childrenDocs) {
          const studentStart = new Date(student.startingDate);
          const targetDate = new Date(yearNum, monthNum - 1);

          // Skip if target month is before student's joining month
          if (
            targetDate <
            new Date(studentStart.getFullYear(), studentStart.getMonth())
          ) {
            continue;
          }

          // Check if this is the student's joining month
          const isJoiningMonth =
            studentStart.getFullYear() === yearNum &&
            studentStart.getMonth() + 1 === monthNum;

          const studentFeeRecords = familyFees.flatMap((fee) =>
            (fee.students || [])
              .filter((s) => {
                const matches =
                  s.studentId === student.uid ||
                  s.name?.toLowerCase() === student.name?.toLowerCase() ||
                  s.studentId === student._id?.toString();
                return matches;
              })
              .map((s) => ({
                feeId: fee._id.toString(),
                paymentType: fee.paymentType,
                status: fee.status,
                monthsPaid: s.monthsPaid || [],
                payments: s.payments || [], // This contains the separate payments
                admissionFee: s.admissionFee || 20,
                monthlyFee: s.monthlyFee || s.monthly_fee || 50,
                discountedFee: s.discountedFee || s.monthlyFee || 50,
                joiningMonth: s.joiningMonth,
                joiningYear: s.joiningYear,
                subtotal: s.subtotal || 0,
                paymentDate: fee.date || fee.timestamp?.$date || fee.timestamp,
                paymentMethod: fee.method,
              }))
          );

          let feeStatus = "unpaid";
          let paidAmount = 0;
          let dueAmount = student.monthly_fee || 50;
          let feeId = null;
          let paymentDate = null;
          let paymentMethod = null;
          let paymentType = null;

          // Apply family discount if exists
          if (family.discount) {
            const discountPercent = Number(family.discount);
            dueAmount = dueAmount - (dueAmount * discountPercent) / 100;
          }

          if (studentFeeRecords.length > 0) {
            // Check for admission fee payment first (if this is the joining month)
            if (isJoiningMonth) {
              const admissionFeeRecord = studentFeeRecords.find(
                (fee) =>
                  fee.paymentType === "admission" ||
                  fee.paymentType === "admissionOnHold"
              );

              if (admissionFeeRecord) {
                // FIXED: Calculate monthly portion from payments array
                const monthlyPayment =
                  admissionFeeRecord.payments?.find(
                    (p) =>
                      p.amount ===
                      admissionFeeRecord.subtotal -
                        admissionFeeRecord.admissionFee
                  ) || admissionFeeRecord.payments?.[1]; // Second payment is monthly portion

                const monthlyPortionPaid =
                  monthlyPayment?.amount ||
                  admissionFeeRecord.subtotal - admissionFeeRecord.admissionFee;

                const expectedMonthlyPortion =
                  admissionFeeRecord.discountedFee || dueAmount;

                paidAmount = monthlyPortionPaid;
                dueAmount = expectedMonthlyPortion;
                feeId = admissionFeeRecord.feeId;
                paymentDate = admissionFeeRecord.paymentDate;
                paymentMethod = admissionFeeRecord.paymentMethod;
                paymentType = admissionFeeRecord.paymentType;

                if (monthlyPortionPaid >= expectedMonthlyPortion) {
                  feeStatus = "paid";
                } else if (monthlyPortionPaid > 0) {
                  feeStatus = "partial";
                } else {
                  feeStatus = "unpaid";
                }
              }
            }

            // If not joining month or no admission record found, check monthly payments
            if (!isJoiningMonth || (isJoiningMonth && feeStatus === "unpaid")) {
              const monthlyFeeRecords = studentFeeRecords.filter(
                (fee) =>
                  fee.paymentType === "monthly" ||
                  fee.paymentType === "monthlyOnHold"
              );

              // Find payment for the specific month
              for (const record of monthlyFeeRecords) {
                const monthPayment = record.monthsPaid.find(
                  (mp) =>
                    parseInt(mp.month, 10) === monthNum &&
                    parseInt(mp.year, 10) === yearNum
                );

                if (monthPayment) {
                  const due =
                    monthPayment.discountedFee ??
                    monthPayment.monthlyFee ??
                    dueAmount;
                  const paid = monthPayment.paid ?? 0;

                  dueAmount = due;
                  paidAmount = paid;
                  feeId = record.feeId;
                  paymentDate = record.paymentDate;
                  paymentMethod = record.paymentMethod;
                  paymentType = record.paymentType;

                  if (paidAmount >= dueAmount) {
                    feeStatus = "paid";
                  } else if (paidAmount > 0) {
                    feeStatus = "partial";
                  } else {
                    feeStatus = "unpaid";
                  }
                  break;
                }
              }
            }
          }

          // Only add to unpaidStudents if not fully paid
          if (feeStatus !== "paid") {
            familyHasUnpaid = true;
            unpaidStudents.push({
              studentId: student._id,
              studentName: student.name,
              monthlyFee: dueAmount,
              paidAmount,
              remainingAmount: Math.max(0, dueAmount - paidAmount),
              status: feeStatus,
              feeId,
              paymentDate,
              paymentMethod,
              paymentType:
                paymentType || (isJoiningMonth ? "admission" : "monthly"),
              isJoiningMonth,
            });
          }
        }

        if (familyHasUnpaid && unpaidStudents.length > 0) {
          result.push({
            familyId: family._id.toString(),
            familyName: family.name,
            familyEmail: family.email,
            familyDiscount: family.discount || 0,
            unpaidStudents,
            totalUnpaidAmount: unpaidStudents.reduce(
              (sum, s) => sum + s.remainingAmount,
              0
            ),
            month: targetMonthKey,
          });
        }
      }

      result.sort((a, b) => a.familyName.localeCompare(b.familyName));
      res.send(result);
    } catch (err) {
      console.error("Error in unpaid-families route:", err);
      res.status(500).send({ error: "Server error" });
    }
  });

  // ✅ Cancel Direct Debit
  router.patch("/cancel-direct-debit", async (req, res) => {
    try {
      const { familyId } = req.body;

      const family = await familiesCollection.findOne({
        _id: new ObjectId(familyId),
      });

      if (!family || !family.directDebit) {
        return res.status(404).json({ error: "No direct debit setup found" });
      }

      // ✅ OPTIONAL: Actually revoke the mandate in Stripe (if it exists)
      try {
        if (family.directDebit.stripeMandateId) {
          // First check if mandate exists
          const mandate = await stripe.mandates.retrieve(
            family.directDebit.stripeMandateId
          );

          // Only revoke if it's active
          if (mandate.status === "active") {
            await stripe.mandates.update(family.directDebit.stripeMandateId, {
              status: "revoked",
            });
            console.log(
              `✅ Revoked Stripe mandate: ${family.directDebit.stripeMandateId}`
            );
          } else {
            console.log(
              `ℹ️ Mandate already ${mandate.status}, no need to revoke`
            );
          }
        }
      } catch (stripeError) {
        console.log(
          "⚠️ Could not revoke Stripe mandate (might already be inactive or not exist):",
          stripeError.message
        );
      }

      const result = await familiesCollection.updateOne(
        { _id: new ObjectId(familyId) },
        {
          $set: {
            "directDebit.status": "cancelled",
            "directDebit.mandateStatus": "cancelled",
            "directDebit.cancelledAt": new Date(),
          },
        }
      );

      res.json({
        success: true,
        modifiedCount: result.modifiedCount,
      });
    } catch (error) {
      console.error("Error cancelling Direct Debit:", error);
      res.status(500).json({ error: error.message });
    }
  });
  // ✅ Refresh ALL pending payments for ALL families
  router.post("/refresh-all-pending-payments", async (req, res) => {
    try {
      console.log("🔄 Starting bulk refresh of ALL pending payments...");

      // 1. Find ALL pending fees with payment intent IDs
      const pendingFees = await feesCollection
        .find({
          status: "pending",
          "payments.stripePaymentIntentId": { $exists: true, $ne: null },
        })
        .toArray();

      console.log(
        `📋 Found ${pendingFees.length} total pending payments to check`
      );

      const results = [];
      let updatedCount = 0;
      let errorCount = 0;

      // 2. Process each pending fee
      for (const fee of pendingFees) {
        const paymentIntentId = fee.payments[0].stripePaymentIntentId;

        try {
          // 3. Check payment status with Stripe
          const paymentIntent = await stripe.paymentIntents.retrieve(
            paymentIntentId
          );

          // 4. If payment succeeded, update our database
          if (paymentIntent.status === "succeeded" && fee.status !== "paid") {
            // Update fee to paid
            await feesCollection.updateOne(
              { _id: fee._id },
              {
                $set: {
                  status: "paid",
                  remaining: 0,
                  updatedAt: new Date(),
                },
              }
            );

            // Update family's last successful payment
            if (fee.familyId) {
              await familiesCollection.updateOne(
                { _id: new ObjectId(fee.familyId) },
                {
                  $set: {
                    "directDebit.lastSuccessfulPayment": new Date(),
                    "directDebit.lastPaymentIntentId": paymentIntentId,
                  },
                }
              );
            }

            updatedCount++;
            console.log(`✅ Updated fee ${fee._id} from pending to paid`);

            results.push({
              feeId: fee._id,
              paymentIntentId: paymentIntentId,
              familyId: fee.familyId,
              amount: fee.expectedTotal,
              previousStatus: "pending",
              newStatus: "paid",
              success: true,
              action: "updated",
            });
          } else if (paymentIntent.status === "processing") {
            // Still processing, no change needed
            results.push({
              feeId: fee._id,
              paymentIntentId: paymentIntentId,
              familyId: fee.familyId,
              amount: fee.expectedTotal,
              status: "pending",
              stripeStatus: paymentIntent.status,
              success: true,
              action: "no_change",
            });
          } else if (
            paymentIntent.status === "requires_payment_method" ||
            paymentIntent.status === "canceled"
          ) {
            // Payment failed
            await feesCollection.updateOne(
              { _id: fee._id },
              {
                $set: {
                  status: "failed",
                  updatedAt: new Date(),
                },
              }
            );

            results.push({
              feeId: fee._id,
              paymentIntentId: paymentIntentId,
              familyId: fee.familyId,
              amount: fee.expectedTotal,
              previousStatus: "pending",
              newStatus: "failed",
              stripeStatus: paymentIntent.status,
              success: true,
              action: "marked_failed",
            });
          } else {
            // Other statuses
            results.push({
              feeId: fee._id,
              paymentIntentId: paymentIntentId,
              familyId: fee.familyId,
              amount: fee.expectedTotal,
              status: fee.status,
              stripeStatus: paymentIntent.status,
              success: true,
              action: "no_change",
            });
          }
        } catch (error) {
          errorCount++;
          console.error(`❌ Error processing fee ${fee._id}:`, error.message);
          results.push({
            feeId: fee._id,
            paymentIntentId: paymentIntentId,
            familyId: fee.familyId,
            error: error.message,
            success: false,
            action: "error",
          });
        }

        // Small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // 5. Return comprehensive results
      const summary = {
        totalProcessed: pendingFees.length,
        successfullyUpdated: updatedCount,
        markedFailed: results.filter((r) => r.action === "marked_failed")
          .length,
        errors: errorCount,
        noChange: results.filter((r) => r.action === "no_change").length,
      };

      console.log(`🎉 Bulk refresh completed:`, summary);

      res.json({
        success: true,
        summary: summary,
        timestamp: new Date().toISOString(),
        details: results,
      });
    } catch (error) {
      console.error("❌ Error in bulk refresh:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ✅ Manual Direct Debit payment collection (for admin)

  // In your families.routes.js or wherever this route is defined
  router.post("/admin/collect-payment", async (req, res) => {
    try {
      const { familyId, amount, description, month, year, feeType } = req.body;

      if (!familyId || !amount) {
        return res.status(400).json({
          error: "Family ID and amount are required",
        });
      }

      // Get family with Direct Debit details
      const family = await familiesCollection.findOne({
        _id: new ObjectId(familyId),
        "directDebit.status": "active",
        "directDebit.mandateStatus": "active",
      });

      if (!family) {
        return res.status(400).json({
          error: "Family not found or Direct Debit not active",
        });
      }

      // ✅ Create the payment intent with comprehensive metadata
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to pence
        currency: "gbp",
        customer: family.directDebit.stripeCustomerId,
        payment_method: family.directDebit.stripePaymentMethodId,
        mandate: family.directDebit.stripeMandateId,
        confirm: true,
        off_session: true,
        metadata: {
          familyId: familyId,
          familyName: family.name,
          familyEmail: family.email,
          description: description || "Direct Debit payment",
          month: month || "",
          year: year || "",
          feeType: feeType || "direct_debit", // ✅ Add feeType
          source: "admin_triggered", // ✅ Identify admin-triggered payments
          amount: amount.toString(), // ✅ Store amount as string
        },
      });

      console.log(`💰 Payment Intent created:`, {
        id: paymentIntent.id,
        status: paymentIntent.status,
        amount: paymentIntent.amount,
      });

      // ✅ RETURN payment intent ID so frontend can save it
      res.json({
        success: true,
        message: `Direct Debit payment of £${amount} initiated for ${family.name}. Status: ${paymentIntent.status}`,
        familyName: family.name,
        amount: amount,
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
      });
    } catch (error) {
      console.error("Direct Debit payment error:", error);

      if (error.type === "StripeCardError") {
        return res.status(400).json({
          error: `Payment failed: ${error.message}`,
        });
      }

      res.status(500).json({
        error: error.message,
      });
    }
  });
  return router;
};
