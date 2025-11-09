require("dotenv").config();
const express = require("express");
const cors = require("cors");

const port = process.env.PORT || 9000;
const app = express();
const admin = require("firebase-admin");
const serviceAccount = require("./alyaqeen-62c18-firebase-adminsdk-fbsvc-1b71e1f5e6.json");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");

const createStudentsRouter = require("./routes/students.routes");
const createUsersRouter = require("./routes/users.routes");
const createFamiliesRouter = require("./routes/families.routes");
const createNotificationsRouter = require("./routes/notifications.routes");
const createFeesRouter = require("./routes/fees.routes");
const createTeachersRouter = require("./routes/teachers.routes");
const createDepartmentsRouter = require("./routes/departments.routes");
const createClassesRouter = require("./routes/classes.routes");
const createSubjectsRouter = require("./routes/subjects.routes");
const createPrayerTimesRouter = require("./routes/prayer_times.routes");
const createGroupsRouter = require("./routes/groups.routes");
const createAttendancesRouter = require("./routes/attendances.routes");
const createMeritsRouter = require("./routes/merits.routes");
const createLessonsCoveredRouter = require("./routes/lessons_covered.routes");
const createNotificationsLogRouter = require("./routes/notifications_log.routes");
const createHolidaysRouter = require("./routes/holidays.routes");
const createReviewsRouter = require("./routes/reviews.routes");

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
let familiesCollection;
let feesCollection;
let studentsCollection;
let departmentsCollection;
let classesCollection;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
let emailSent = new Set(); // Add this back
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.log(`❌ Webhook signature verification failed.`, err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      switch (event.type) {
        case "checkout.session.completed":
          const checkoutSession = event.data.object;

          // Get the setup intent ID from the checkout session
          const setupIntentId = checkoutSession.setup_intent;

          if (setupIntentId && checkoutSession.metadata.familyId) {
            // Retrieve the setup intent to get payment method
            const setupIntent = await stripe.setupIntents.retrieve(
              setupIntentId
            );

            if (setupIntent.status === "succeeded") {
              // ✅ PASS THE CHECKOUT SESSION METADATA DIRECTLY
              await processSuccessfulSetupIntent(
                setupIntent,
                checkoutSession.metadata.familyId,
                checkoutSession.metadata.preferredPaymentDate // ✅ Pass the preferred date directly
              );
            }
          }
          break;

        case "mandate.updated":
          const mandate = event.data.object;
          await handleMandateUpdate(mandate);
          break;

        case "payment_intent.succeeded":
          await handleSuccessfulDirectDebitPayment(event.data.object);
          break;

        case "payment_intent.payment_failed":
          await handleFailedDirectDebitPayment(event.data.object);
          break;
        case "charge.failed":
          console.log(`❌ CHARGE FAILED:`, event.data.object.id);
          await handleFailedCharge(event.data.object);
          break;
        case "payment_intent.processing":
          console.log(`🔄 PAYMENT PROCESSING:`, event.data.object.id);
          break;

        case "payment_intent.created":
          console.log(`🆕 PAYMENT CREATED:`, event.data.object.id);
          break;

        case "charge.pending":
          console.log(`🔄 CHARGE PENDING:`, event.data.object.id);
          await handlePendingCharge(event.data.object);
          break;

        case "charge.updated":
          console.log(`📝 CHARGE UPDATED:`, event.data.object.id);
          await handleChargeUpdated(event.data.object);
          break;

        case "payment_intent.requires_action":
          console.log(`⚠️ PAYMENT REQUIRES ACTION:`, event.data.object.id);
          break;

        case "payment_intent.canceled":
          console.log(`❌ PAYMENT CANCELED:`, event.data.object.id);
          await handlePaymentCanceled(event.data.object);
          break;
        case "setup_intent.succeeded":
          break;

        default:
          console.log(`🔵 Unhandled event type ${event.type}`);
      }

      res.json({ received: true });
    } catch (error) {
      console.error("❌ Webhook processing error:", error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  }
);

// Separate function to process successful setup
// Separate function to process successful setup
async function processSuccessfulSetupIntent(
  setupIntent,
  familyId,
  preferredPaymentDateFromCheckout
) {
  try {
    if (!familiesCollection) return;

    const family = await familiesCollection.findOne({
      _id: new ObjectId(familyId),
    });
    if (!family) return;

    const paymentMethod = await stripe.paymentMethods.retrieve(
      setupIntent.payment_method
    );

    if (paymentMethod.type === "bacs_debit") {
      const mandateId = setupIntent.mandate;

      // ✅ FIX: ALWAYS SET TO PENDING INITIALLY
      // Don't check mandate status here - let the webhook handle it
      const result = await familiesCollection.updateOne(
        { _id: new ObjectId(familyId) },
        {
          $set: {
            directDebit: {
              stripePaymentMethodId: paymentMethod.id,
              stripeSetupIntentId: setupIntent.id,
              stripeMandateId: mandateId,
              stripeCustomerId: setupIntent.customer,
              bankName: paymentMethod.bacs_debit?.bank_name || "Unknown Bank",
              last4: paymentMethod.bacs_debit?.last4 || "****",
              setupDate: new Date(),
              status: "pending", // ← ALWAYS start as pending
              mandateStatus: "pending", // ← ALWAYS start as pending
              activeDate: null,
              preferredPaymentDate:
                parseInt(preferredPaymentDateFromCheckout) || 1,
            },
          },
        }
      );

      console.log(
        `✅ Database updated with PENDING status: ${result.modifiedCount} documents`
      );

      // ✅ SEND PENDING EMAIL HERE
      if (family.email && family.name) {
        const students = await studentsCollection
          .find({ familyId: familyId })
          .toArray();

        const studentNames =
          students.map((student) => student.name).join(", ") || "Your child";

        try {
          const emailResult = await sendDirectDebitEmail({
            to: family.email,
            name: family.name,
            studentName: studentNames,
            status: "pending",
            mandateId: mandateId || "Pending verification",
          });

          if (emailResult && emailResult.success) {
            console.log(`✅ Pending email sent to ${family.email}`);
          }
        } catch (emailError) {
          console.error("❌ Pending email sending crashed:", emailError);
        }
      }
    } else {
      console.log("❌ Payment method is not bacs_debit:", paymentMethod.type);
    }
  } catch (error) {
    console.error("❌ Error processing setup intent:", error);
  }
}

// ✅ FIXED: Handle mandate status updates
async function handleMandateUpdate(mandate) {
  try {
    console.log(`🔄 handleMandateUpdate CALLED with mandate:`, {
      id: mandate.id,
      status: mandate.status,
    });

    if (!familiesCollection) {
      console.log("❌ familiesCollection not available");
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const family = await familiesCollection.findOne({
      "directDebit.stripeMandateId": mandate.id,
    });

    if (!family) {
      console.log(`❌ No family found with mandate ID: ${mandate.id}`);
      return;
    }

    console.log(
      `✅ Found family: ${family.name}, current status: ${family.directDebit.status}`
    );

    let newStatus = family.directDebit.status;
    let emailStatus = null;
    let shouldSendEmail = false;

    // ✅ DETERMINE STATUS AND EMAIL TYPE
    if (mandate.status === "active") {
      newStatus = "active";
      // Only send email if status is changing from pending to active
      if (family.directDebit.status === "pending") {
        emailStatus = "success";
        shouldSendEmail = true;
        console.log(
          `✅ Updating status from ${family.directDebit.status} to ${newStatus} - will send success email`
        );
      } else {
        console.log(`ℹ️ Mandate already active, no email needed`);
      }
    } else if (mandate.status === "inactive" || mandate.status === "revoked") {
      newStatus = "cancelled";
      emailStatus = "failed";
      shouldSendEmail = true;
      console.log(`❌ Mandate ${mandate.status} - will send failed email`);
    }

    // ✅ UPDATE THE DATABASE
    const updateData = {
      "directDebit.status": newStatus,
      "directDebit.mandateStatus": mandate.status,
      "directDebit.lastUpdated": new Date(),
    };

    // ✅ SET activeDate ONLY WHEN BECOMING ACTIVE
    if (mandate.status === "active" && family.directDebit.status !== "active") {
      updateData["directDebit.activeDate"] = new Date();
    }

    const result = await familiesCollection.updateOne(
      { _id: family._id },
      { $set: updateData }
    );

    console.log(
      `✅ Database update result: ${result.modifiedCount} documents modified`
    );

    // ✅ VERIFY THE UPDATE
    if (result.modifiedCount > 0) {
      const updatedFamily = await familiesCollection.findOne({
        _id: family._id,
      });
      console.log(`✅ VERIFICATION - New status:`, {
        status: updatedFamily.directDebit.status,
        mandateStatus: updatedFamily.directDebit.mandateStatus,
        activeDate: updatedFamily.directDebit.activeDate,
      });
    }

    // ✅ SEND STATUS UPDATE EMAIL ONLY WHEN NEEDED
    if (shouldSendEmail && emailStatus && family.email) {
      const students = await studentsCollection
        .find({
          familyId: family._id.toString(),
        })
        .toArray();

      const studentNames =
        students.map((student) => student.name).join(", ") || "Your child";

      try {
        const emailResult = await sendDirectDebitEmail({
          to: family.email,
          name: family.name || "Parent",
          studentName: studentNames,
          status: emailStatus,
          mandateId: mandate.id,
        });

        if (emailResult && emailResult.success) {
          console.log(`✅ ${emailStatus} email sent to ${family.email}`);

          // ✅ MARK THAT EMAIL WAS SENT
          if (emailStatus === "success") {
            emailSent.add(family._id.toString());
          }
        } else {
          console.log(
            `❌ Failed to send ${emailStatus} email: ${
              emailResult?.reason || "Unknown error"
            }`
          );
        }
      } catch (emailError) {
        console.error(`❌ ${emailStatus} email sending crashed:`, emailError);
      }
    } else {
      console.log(`ℹ️ No email sent - conditions:`, {
        shouldSendEmail,
        emailStatus,
        hasEmail: !!family.email,
      });
    }
  } catch (error) {
    console.error("❌ Error handling mandate update:", error);
  }
}
async function handleSuccessfulDirectDebitPayment(paymentIntent) {
  try {
    console.log(`💰 Handling successful payment:`, paymentIntent.id);

    if (!feesCollection || !familiesCollection) return;

    // Find fee by payment intent ID
    let existingFee = await feesCollection.findOne({
      "payments.stripePaymentIntentId": paymentIntent.id,
    });

    if (existingFee) {
      console.log(`✅ Found fee to update: ${existingFee._id}`);

      // Update the fee status to paid
      await feesCollection.updateOne(
        { _id: existingFee._id },
        {
          $set: {
            status: "paid",
            remaining: 0,
            updatedAt: new Date(),
          },
        }
      );
      console.log(`✅ Fee ${existingFee._id} marked as paid`);

      // ✅ SEND SUCCESS EMAIL BASED ON PAYMENT TYPE
      try {
        if (
          existingFee.paymentType === "monthly" ||
          existingFee.paymentType === "monthlyOnHold"
        ) {
          // Monthly payment email
          await sendMonthlyFeeEmail({
            to: existingFee.email,
            parentName: existingFee.name,
            students: existingFee.students.map((student) => ({
              name: student.name,
              monthsPaid: student.monthsPaid || [],
              subtotal: student.subtotal,
            })),
            totalAmount: existingFee.expectedTotal,
            method: "direct_debit",
            paymentDate:
              existingFee.payments?.[0]?.date ||
              new Date().toISOString().slice(0, 10),
            isOnHold: false,
            remainingAmount: 0,
          });
          console.log(`✅ Monthly success email sent to ${existingFee.email}`);
        } else if (existingFee.paymentType === "admission") {
          // Admission payment email
          const enrichedStudents = await createFeesRouter?.enrichStudents(
            existingFee.students,
            studentsCollection,
            departmentsCollection,
            classesCollection
          );

          const studentBreakdown = enrichedStudents.map((enrichedStudent) => {
            const originalStudent = existingFee.students.find(
              (s) => String(s.studentId) === String(enrichedStudent._id)
            );
            const totalPaid = originalStudent?.subtotal || 0;

            return {
              ...enrichedStudent,
              subtotal: totalPaid,
            };
          });

          await sendEmailViaAPI({
            to: existingFee.email,
            parentName: existingFee.name,
            students: studentBreakdown,
            totalAmount: existingFee.expectedTotal,
            method: "direct_debit",
            paymentDate:
              existingFee.payments?.[0]?.date ||
              new Date().toISOString().slice(0, 10),
            studentBreakdown: studentBreakdown,
            isEnrollmentConfirmed: true,
          });
          console.log(
            `✅ Admission success email sent to ${existingFee.email}`
          );
        }
      } catch (emailError) {
        console.error("❌ Success email failed:", emailError);
      }
    } else {
      console.log(`❌ No fee found for payment intent: ${paymentIntent.id}`);
    }

    // Update family payment history
    const family = await familiesCollection.findOne({
      "directDebit.stripeCustomerId": paymentIntent.customer,
    });

    if (family) {
      await familiesCollection.updateOne(
        { _id: family._id },
        {
          $set: {
            "directDebit.lastSuccessfulPayment": new Date(),
            "directDebit.lastPaymentIntentId": paymentIntent.id,
          },
        }
      );
    }
  } catch (error) {
    console.error("❌ Error handling successful payment:", error);
  }
}
// In your index.js, add this route:
app.post("/reconcile-payment", async (req, res) => {
  try {
    const { paymentIntentId } = req.body;

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const fee = await feesCollection.findOne({
      "payments.stripePaymentIntentId": paymentIntentId,
    });

    res.json({
      paymentIntent: {
        id: paymentIntent.id,
        status: paymentIntent.status,
        amount: paymentIntent.amount / 100,
        metadata: paymentIntent.metadata,
      },
      fee: fee
        ? {
            id: fee._id,
            status: fee.status,
            paymentIntentId: fee.payments?.[0]?.stripePaymentIntentId,
          }
        : null,
      match: !!fee,
    });
  } catch (error) {
    console.error("Reconciliation error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function for admission fees
// async function createAdmissionFeeStructure(studentData, totalAmount) {
//   const admissionFeePerStudent = 20;
//   const students = studentData.selectedStudents;
//   const discountPercent = studentData.discountPercent || 0;

//   // Calculate allocations
//   const totalAdmissionNeeded = admissionFeePerStudent * students.length;
//   const totalMonthlyNeeded = students.reduce(
//     (sum, student) =>
//       sum + calculateDiscountedFee(student.monthly_fee, discountPercent),
//     0
//   );

//   const expectedTotal = totalAdmissionNeeded + totalMonthlyNeeded;

//   let allocations = [];

//   if (totalAmount >= expectedTotal) {
//     // Full payment
//     allocations = students.map((student) => ({
//       studentId: student.studentId,
//       name: student.name,
//       paidAdmission: admissionFeePerStudent,
//       paidMonthly: calculateDiscountedFee(student.monthly_fee, discountPercent),
//     }));
//   } else {
//     // Partial payment - prioritize admission fees
//     const totalAdmissionAllocated = Math.min(totalAmount, totalAdmissionNeeded);
//     const admissionPerStudent = totalAdmissionAllocated / students.length;
//     const remainingAfterAdmission = totalAmount - totalAdmissionAllocated;

//     allocations = students.map((student) => {
//       const monthlyShare =
//         totalMonthlyNeeded > 0
//           ? (calculateDiscountedFee(student.monthly_fee, discountPercent) /
//               totalMonthlyNeeded) *
//             remainingAfterAdmission
//           : 0;

//       return {
//         studentId: student.studentId,
//         name: student.name,
//         paidAdmission: toTwo(admissionPerStudent),
//         paidMonthly: toTwo(monthlyShare),
//       };
//     });
//   }

//   // Create student payload
//   return allocations.map((allocation) => {
//     const student = students.find((s) => s.studentId === allocation.studentId);
//     const startingDate = new Date(student.startingDate);

//     return {
//       studentId: allocation.studentId,
//       name: allocation.name,
//       admissionFee: admissionFeePerStudent,
//       monthlyFee: student.monthly_fee,
//       discountedFee: calculateDiscountedFee(
//         student.monthly_fee,
//         discountPercent
//       ),
//       joiningMonth: (startingDate.getMonth() + 1).toString().padStart(2, "0"),
//       joiningYear: startingDate.getFullYear(),
//       payments: [
//         {
//           amount: allocation.paidAdmission,
//           date: studentData.paymentDate
//             ? new Date(studentData.paymentDate)
//             : new Date(),
//           method: "direct_debit",
//         },
//         ...(allocation.paidMonthly > 0
//           ? [
//               {
//                 amount: allocation.paidMonthly,
//                 date: studentData.paymentDate
//                   ? new Date(studentData.paymentDate)
//                   : new Date(),
//                 method: "direct_debit",
//               },
//             ]
//           : []),
//       ],
//       subtotal: toTwo(allocation.paidAdmission + allocation.paidMonthly),
//     };
//   });
// }

// Helper function for monthly fees
// async function createMonthlyFeeStructure(
//   studentData,
//   month,
//   year,
//   totalAmount
// ) {
//   const students = studentData.selectedStudents;
//   const discountPercent = studentData.discountPercent || 0;

//   const totalExpected = students.reduce(
//     (sum, student) =>
//       sum + calculateDiscountedFee(student.monthly_fee, discountPercent),
//     0
//   );

//   // Allocate payment proportionally
//   let allocations = students.map((student) => ({
//     studentId: student.studentId,
//     name: student.name,
//     rawPaid:
//       totalExpected > 0
//         ? (calculateDiscountedFee(student.monthly_fee, discountPercent) /
//             totalExpected) *
//           totalAmount
//         : 0,
//   }));

//   // Round allocations to avoid floating point issues
//   allocations.forEach((a) => (a.paid = Math.floor(a.rawPaid * 100) / 100));

//   let allocatedSum = allocations.reduce((sum, a) => sum + a.paid, 0);
//   let remainderCents = Math.round((totalAmount - allocatedSum) * 100);

//   // Distribute remainder
//   if (remainderCents > 0) {
//     allocations.sort((a, b) => b.rawPaid - b.paid - (a.rawPaid - a.paid));
//     for (let i = 0; i < allocations.length && remainderCents > 0; i++) {
//       allocations[i].paid = toTwo(allocations[i].paid + 0.01);
//       remainderCents--;
//     }
//   }

//   return allocations.map((allocation) => ({
//     studentId: allocation.studentId,
//     name: allocation.name,
//     monthsPaid: [
//       {
//         month: (month || "").padStart(2, "0"),
//         year: year || new Date().getFullYear(),
//         monthlyFee: students.find((s) => s.studentId === allocation.studentId)
//           .monthly_fee,
//         discountedFee: calculateDiscountedFee(
//           students.find((s) => s.studentId === allocation.studentId)
//             .monthly_fee,
//           discountPercent
//         ),
//         paid: allocation.paid,
//       },
//     ],
//     subtotal: allocation.paid,
//   }));
// }

function calculateDiscountedFee(baseFee, discountPercent) {
  return toTwo(baseFee - (baseFee * (discountPercent || 0)) / 100);
}

function toTwo(num) {
  return Number(Number(num).toFixed(2));
}
// ✅ NEW FUNCTION: Handle failed Direct Debit payments
async function handleFailedDirectDebitPayment(paymentIntent) {
  try {
    console.log(`❌ Handling failed payment:`, paymentIntent.id);

    if (!feesCollection) return;

    // Find fee by payment intent ID
    const fee = await feesCollection.findOne({
      "payments.stripePaymentIntentId": paymentIntent.id,
    });

    if (fee) {
      console.log(`✅ Found fee to mark as failed: ${fee._id}`);

      await feesCollection.updateOne(
        { _id: fee._id },
        {
          $set: {
            status: "failed",
            updatedAt: new Date(),
          },
        }
      );
      console.log(`✅ Fee ${fee._id} marked as failed`);
    }
  } catch (error) {
    console.error("❌ Error handling failed payment:", error);
  }
}

async function handlePendingCharge(charge) {
  try {
    console.log(`🔄 Processing pending charge:`, charge.id);

    if (!feesCollection) return;

    // Find fee by payment intent ID
    const paymentIntent = await stripe.paymentIntents.retrieve(
      charge.payment_intent
    );

    const fee = await feesCollection.findOne({
      "payments.stripePaymentIntentId": paymentIntent.id,
    });

    if (fee) {
      // If fee exists, update to pending
      await feesCollection.updateOne(
        { _id: fee._id },
        {
          $set: {
            status: "pending",
            updatedAt: new Date(),
          },
        }
      );
      console.log(`✅ Fee ${fee._id} marked as pending`);
    } else {
      console.log(
        `⏳ No fee found yet for payment intent: ${paymentIntent.id}`
      );
      console.log(`📋 Payment intent metadata:`, paymentIntent.metadata);

      // ✅ DON'T create a new fee here - wait for frontend to create the proper fee structure
      // The frontend will create the complete fee record with student details
      // We'll just log this and let the successful payment webhook handle the update later

      console.log(
        `ℹ️ Waiting for frontend to create proper fee record for payment intent: ${paymentIntent.id}`
      );
    }
  } catch (error) {
    console.error("❌ Error handling pending charge:", error);
  }
}

async function handleFailedCharge(charge) {
  try {
    console.log(`❌ Handling failed charge:`, charge.id);

    if (!feesCollection) return;

    // Get the payment intent to find the fee
    const paymentIntent = await stripe.paymentIntents.retrieve(
      charge.payment_intent
    );

    const fee = await feesCollection.findOne({
      "payments.stripePaymentIntentId": paymentIntent.id,
    });

    if (fee) {
      console.log(`✅ Found fee to mark as failed: ${fee._id}`);

      await feesCollection.updateOne(
        { _id: fee._id },
        {
          $set: {
            status: "failed",
            updatedAt: new Date(),
          },
        }
      );
      console.log(`✅ Fee ${fee._id} marked as failed`);
    }
  } catch (error) {
    console.error("❌ Error handling failed charge:", error);
  }
}

async function handleChargeUpdated(charge) {
  try {
    console.log(`📝 Charge updated:`, charge.id, charge.status);
    // You can add specific logic here if needed
  } catch (error) {
    console.error("❌ Error handling charge update:", error);
  }
}

async function handlePaymentCanceled(paymentIntent) {
  try {
    console.log(`❌ Payment canceled:`, paymentIntent.id);

    if (!feesCollection) return;

    const fee = await feesCollection.findOne({
      "payments.stripePaymentIntentId": paymentIntent.id,
    });

    if (fee) {
      await feesCollection.updateOne(
        { _id: fee._id },
        {
          $set: {
            status: "canceled",
            updatedAt: new Date(),
          },
        }
      );
      console.log(`✅ Fee ${fee._id} marked as canceled`);
    } else {
      console.log(
        `ℹ️ No fee found to mark as canceled for payment intent: ${paymentIntent.id}`
      );
    }
  } catch (error) {
    console.error("❌ Error handling canceled payment:", error);
  }
}
// ... keep the handleSuccessfulDirectDebitPayment and handleFailedDirectDebitPayment functions the same as before
//Must remove "/" from your production URL
app.use(
  cors({
    origin: ["http://localhost:5173", "https://alyaqeen.vercel.app"],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
};
//localhost:5000 and localhost:5173 are treated as same site.  so sameSite value must be strict in development server.  in production sameSite will be none
// in development server secure will false .  in production secure will be true

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { sendMonthlyReminders } = require("./config/paymentReminders");
const sendDirectDebitEmail = require("./config/sendDirectDebitEmail");
const sendMonthlyFeeEmail = require("./config/sendMonthlyFeeEmail");
const sendEmailViaAPI = require("./config/sendAdmissionEmail");

// old
// const uri = `mongodb+srv://${process.env.DB_User}:${process.env.DB_Pass}@cluster0.dr5qw.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const uri = `mongodb+srv://${process.env.DB_User}:${process.env.DB_Pass}@cluster0.ts2xohe.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).send({ message: true });
  }
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.user = decoded;
    next();
  });
};

async function run() {
  try {
    // collections
    const usersCollection = client.db("alyaqeenDb").collection("users");
    studentsCollection = client.db("alyaqeenDb").collection("students");
    familiesCollection = client.db("alyaqeenDb").collection("families");
    feesCollection = client.db("alyaqeenDb").collection("fees");
    const teachersCollection = client.db("alyaqeenDb").collection("teachers");
    const prayerTimesCollection = client
      .db("alyaqeenDb")
      .collection("prayer-times");
    departmentsCollection = client.db("alyaqeenDb").collection("departments");
    classesCollection = client.db("alyaqeenDb").collection("classes");
    const subjectsCollection = client.db("alyaqeenDb").collection("subjects");
    const groupsCollection = client.db("alyaqeenDb").collection("groups");
    const meritsCollection = client.db("alyaqeenDb").collection("merits");
    const holidaysCollection = client.db("alyaqeenDb").collection("holidays");
    const reviewsCollection = client.db("alyaqeenDb").collection("reviews");
    const lessonsCoveredCollection = client
      .db("alyaqeenDb")
      .collection("lessons-covered");
    const attendancesCollection = client
      .db("alyaqeenDb")
      .collection("attendances");
    const notificationsLogCollection = client
      .db("alyaqeenDb")
      .collection("notifications-log");
    const notificationsCollection = client
      .db("alyaqeenDb")
      .collection("notifications");
    // ADD THE COUNTERS COLLECTION HERE
    const countersCollection = client.db("alyaqeenDb").collection("counters");

    // Initialize the counter if it doesn't exist
    // await countersCollection.updateOne(
    //   { _id: "studentId" },
    //   { $setOnInsert: { sequence_value: 0 } },
    //   { upsert: true }
    // );
    app.post("/jwt", async (req, res) => {
      const email = req.body;
      const token = jwt.sign(email, process.env.JWT_SECRET, {
        expiresIn: "1h",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
      //   console.log(token);
    });
    app.get("/logout", async (req, res) => {
      res
        .clearCookie("token", {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
          maxAge: 0,
        })
        .send({ success: true });
    });

    app.post("/create-student-user", async (req, res) => {
      const { email, password, displayName } = req.body;

      if (!email || !password) {
        return res
          .status(400)
          .send({ error: "Email and password are required." });
      }

      try {
        const userRecord = await admin.auth().createUser({
          email,
          password,
          displayName,
        });

        // Optional: assign custom claims if needed, e.g., role: "student"
        await admin
          .auth()
          .setCustomUserClaims(userRecord.uid, { role: "student" });

        res.send({
          message: "Student user created successfully",
          uid: userRecord.uid,
          email: userRecord.email,
        });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.use(
      "/students",
      createStudentsRouter(
        studentsCollection,
        verifyToken,
        familiesCollection,
        classesCollection,
        groupsCollection,
        countersCollection
      )
    );
    app.use("/users", createUsersRouter(usersCollection));
    app.use(
      "/families",
      createFamiliesRouter(
        familiesCollection,
        studentsCollection,
        feesCollection
      )
    );
    app.use(
      "/notifications",
      createNotificationsRouter(notificationsCollection, verifyToken)
    );
    app.use(
      "/fees",
      createFeesRouter(
        feesCollection,
        studentsCollection,
        familiesCollection,
        departmentsCollection,
        classesCollection
      )
    );
    app.use(
      "/teachers",
      createTeachersRouter(
        teachersCollection,
        departmentsCollection,
        classesCollection,
        subjectsCollection
      )
    );
    app.use("/departments", createDepartmentsRouter(departmentsCollection));
    app.use("/classes", createClassesRouter(classesCollection));
    app.use("/subjects", createSubjectsRouter(subjectsCollection));
    app.use("/prayer-times", createPrayerTimesRouter(prayerTimesCollection));
    app.use("/groups", createGroupsRouter(groupsCollection));
    app.use("/holidays", createHolidaysRouter(holidaysCollection));
    app.use("/reviews", createReviewsRouter(reviewsCollection));
    app.use(
      "/attendances",
      createAttendancesRouter(
        attendancesCollection,
        notificationsLogCollection,
        studentsCollection
      )
    );
    app.use(
      "/notifications-log",
      createNotificationsLogRouter(notificationsLogCollection)
    );
    app.use(
      "/lessons-covered",
      createLessonsCoveredRouter(
        lessonsCoveredCollection,
        studentsCollection,
        teachersCollection
      )
    );
    app.use(
      "/merits",
      createMeritsRouter(
        meritsCollection,
        notificationsCollection,
        studentsCollection
      )
    );

    // stripe payment intent
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100); // Convert to cents
      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: "gbp",
        payment_method_types: ["card"],
      });

      res.send({ clientSecret: paymentIntent.client_secret });
    });

    // ✅ Route to create SetupIntent for BACS Direct Debit
    // ✅ Route to create SetupIntent for BACS Direct Debit
    app.post("/create-bacs-checkout-session", async (req, res) => {
      try {
        const { email, familyId, name, preferredPaymentDate } = req.body;

        // ✅ STEP 1: Check if family already has a Stripe customer
        const family = await familiesCollection.findOne({
          _id: new ObjectId(familyId),
        });

        let customer;

        // ✅ If family already has a Stripe customer ID, try to REUSE IT
        if (family.directDebit && family.directDebit.stripeCustomerId) {
          console.log(
            `♻️ Attempting to reuse existing Stripe customer: ${family.directDebit.stripeCustomerId}`
          );

          try {
            // ✅ TRY to retrieve the existing customer
            customer = await stripe.customers.retrieve(
              family.directDebit.stripeCustomerId
            );
            console.log(
              `✅ Successfully reused existing customer: ${customer.id}`
            );

            // Update customer details if needed
            if (name && customer.name !== name) {
              customer = await stripe.customers.update(customer.id, {
                name: name,
                email: email,
              });
            }
          } catch (stripeError) {
            if (stripeError.code === "resource_missing") {
              // ✅ CUSTOMER DOESN'T EXIST IN STRIPE - CREATE NEW ONE
              console.log(
                `❌ Customer not found in Stripe, creating new one...`
              );

              customer = await stripe.customers.create({
                email: email,
                name: name,
                metadata: {
                  familyId: familyId,
                  source: "bacs_direct_debit_setup_recreated",
                },
              });
              console.log(`🆕 Created new Stripe customer: ${customer.id}`);

              // ✅ UPDATE THE FAMILY RECORD WITH THE NEW CUSTOMER ID
              await familiesCollection.updateOne(
                { _id: new ObjectId(familyId) },
                {
                  $set: {
                    "directDebit.stripeCustomerId": customer.id,
                    "directDebit.status": "pending",
                    "directDebit.mandateStatus": "pending",
                    "directDebit.setupDate": new Date(),
                  },
                }
              );
              console.log(`✅ Updated family record with new customer ID`);
            } else {
              // Some other Stripe error - rethrow it
              throw stripeError;
            }
          }
        } else {
          // ✅ No existing customer - CREATE NEW ONE
          console.log(`🆕 No existing customer found, creating new one...`);

          // First check if customer exists by email
          const existingCustomers = await stripe.customers.list({
            email: email,
            limit: 1,
          });

          if (existingCustomers.data.length > 0) {
            customer = existingCustomers.data[0];
            console.log(
              `🔍 Found existing Stripe customer by email: ${customer.id}`
            );

            // Update customer details
            if (name && customer.name !== name) {
              customer = await stripe.customers.update(customer.id, {
                name: name,
              });
            }
          } else {
            // Create new customer
            customer = await stripe.customers.create({
              email: email,
              name: name,
              metadata: {
                familyId: familyId,
                source: "bacs_direct_debit_setup_new",
              },
            });
            console.log(`🆕 Created new Stripe customer: ${customer.id}`);
          }
        }

        // ✅ STEP 2: Create Checkout Session
        const session = await stripe.checkout.sessions.create({
          mode: "setup",
          payment_method_types: ["bacs_debit"],
          customer: customer.id,
          success_url: `${process.env.FRONTEND_URL}/dashboard/parent/payment-success`,
          cancel_url: `${process.env.FRONTEND_URL}/dashboard/parent/payment-cancel`,
          metadata: {
            familyId: familyId,
            customerId: customer.id,
            preferredPaymentDate: preferredPaymentDate || "1",
          },
        });

        res.json({
          url: session.url,
          sessionId: session.id,
          customerId: customer.id,
        });
      } catch (error) {
        console.error("Stripe BACS Checkout Error:", error.message);
        res.status(500).json({ error: error.message });
      }
    });
    // In your backend (server.js)

    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

// === ADD PAYMENT REMINDERS ROUTE ===
app.get("/api/send-reminders", async (req, res) => {
  // Get current UK time
  const now = new Date();
  const ukTime = new Date(
    now.toLocaleString("en-US", { timeZone: "Europe/London" })
  );
  const currentDay = ukTime.getDate();

  console.log(`🕛 UK Time: ${ukTime.toISOString()}, Day: ${currentDay}`);

  // Check if today is a reminder day
  let reminderDay;
  if (currentDay === 16) reminderDay = 16; // Changed from 10 to 16
  else if (currentDay === 29)
    reminderDay = 29; // Keep 29, remove the 20th condition
  else {
    return res.json({ message: "Not a reminder day in UK time" });
  }

  console.log(`📧 Processing ${reminderDay}th day reminders...`);

  try {
    const { sendMonthlyReminders } = require("./config/paymentReminders");
    await sendMonthlyReminders(reminderDay);

    res.json({
      success: true,
      message: `Reminders sent for day ${reminderDay}`,
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to send reminders" });
  }
});

app.get("/", async (req, res) => {
  res.send("Alyaqeen server is running");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
