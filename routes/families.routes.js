const express = require("express");
const { ObjectId } = require("mongodb");
const studentEnrichmentStages = require("../config/studentEnrichmentStages");
const router = express.Router();

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
  // router.patch("/update-by-admin/:id", async (req, res) => {
  //   try {
  //     const id = req.params.id;
  //     if (!ObjectId.isValid(id)) {
  //       return res.status(400).send({ error: "Invalid ID format" });
  //     }

  //     const query = { _id: new ObjectId(id) };
  //     const { name, children, discount } = req.body;

  //     if (!Array.isArray(children)) {
  //       return res.status(400).json({ error: "Invalid children array" });
  //     }

  //     // 🔹 Fetch family to get current state and family details
  //     const familyDoc = await familiesCollection.findOne(query);
  //     if (!familyDoc) {
  //       return res.status(404).json({ error: "Family not found" });
  //     }

  //     // 🔹 Auto-detect added and removed children
  //     const currentChildren = familyDoc.children || [];
  //     const newlyAddedChildren = children.filter(
  //       (child) => !currentChildren.includes(child)
  //     );
  //     const removedChildren = currentChildren.filter(
  //       (child) => !children.includes(child)
  //     );

  //     // ✅ Check if newly added children already belong to other families
  //     if (newlyAddedChildren.length > 0) {
  //       const existingStudents = await studentsCollection
  //         .find({
  //           uid: { $in: newlyAddedChildren },
  //           parentUid: { $exists: true, $ne: "" }, // Check if they have a parentUid
  //           parentUid: { $ne: familyDoc.uid }, // Exclude if they already belong to this family
  //         })
  //         .toArray();

  //       if (existingStudents.length > 0) {
  //         return res.status(400).json({
  //           error: "Some students already belong to other families",
  //           conflictedStudents: existingStudents.map((student) => ({
  //             uid: student.uid,
  //             name: student.name,
  //             currentFamily: student.family_name,
  //             parentUid: student.parentUid,
  //           })),
  //           message:
  //             `Please remove the students from their $student.family_name first`,
  //         });
  //       }
  //     }

  //     // Update family document
  //     const updatedDoc = {
  //       $set: {
  //         name,
  //         discount: Number(discount) || 0,
  //         children,
  //         updatedAt: new Date(),
  //       },
  //     };

  //     const familyResult = await familiesCollection.updateOne(
  //       query,
  //       updatedDoc
  //     );

  //     // ✅ Handle newly added students - Set family fields
  //     if (newlyAddedChildren.length > 0) {
  //       await studentsCollection.updateMany(
  //         { uid: { $in: newlyAddedChildren } },
  //         {
  //           $set: {
  //             email: familyDoc.email,
  //             family_name: familyDoc.name,
  //             parentUid: familyDoc.uid,
  //           },
  //         }
  //       );
  //     }

  //     // ✅ Handle removed students - Clear family fields
  //     if (removedChildren.length > 0) {
  //       await studentsCollection.updateMany(
  //         { uid: { $in: removedChildren } },
  //         {
  //           $set: {
  //             email: "",
  //             family_name: "",
  //             parentUid: "",
  //           },
  //         }
  //       );
  //     }

  //     res.send({
  //       success: true,
  //       modifiedCount: familyResult.modifiedCount,
  //       addedCount: newlyAddedChildren.length,
  //       removedCount: removedChildren.length,
  //     });
  //   } catch (error) {
  //     console.error("Update family error:", error);
  //     res.status(500).send({ error: "Failed to update family" });
  //   }
  // });

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

                console.log(`Admission fee analysis for ${student.name}:`, {
                  admissionFee: admissionFeeRecord.admissionFee,
                  subtotal: admissionFeeRecord.subtotal,
                  monthlyPortionPaid,
                  expectedMonthlyPortion,
                  feeStatus,
                  payments: admissionFeeRecord.payments,
                });
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

  return router;
};
