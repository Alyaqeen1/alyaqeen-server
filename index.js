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

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

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
              await processSuccessfulSetupIntent(
                setupIntent,
                checkoutSession.metadata.familyId
              );
            }
          }
          break;

        // ✅ ADD MANDATE STATUS TRACKING
        case "mandate.updated":
          const mandate = event.data.object;

          await handleMandateUpdate(mandate);
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
async function processSuccessfulSetupIntent(setupIntent, familyId) {
  try {
    if (!familiesCollection) {
      return;
    }

    // Get the payment method details
    const paymentMethod = await stripe.paymentMethods.retrieve(
      setupIntent.payment_method
    );

    if (paymentMethod.type === "bacs_debit") {
      // ✅ GET MANDATE INFORMATION
      const mandateId = setupIntent.mandate;
      let mandateStatus = "pending";

      if (mandateId) {
        try {
          const mandate = await stripe.mandates.retrieve(mandateId);
          mandateStatus = mandate.status;
        } catch (error) {
          console.log("❌ Could not retrieve mandate:", error.message);
        }
      }

      const result = await familiesCollection.updateOne(
        { _id: new ObjectId(familyId) },
        {
          $set: {
            directDebit: {
              stripePaymentMethodId: paymentMethod.id,
              stripeSetupIntentId: setupIntent.id,
              stripeMandateId: mandateId, // ✅ STORE MANDATE ID
              bankName: paymentMethod.bacs_debit?.bank_name || "Unknown Bank",
              last4: paymentMethod.bacs_debit?.last4 || "****",
              setupDate: new Date(),
              status: mandateStatus === "active" ? "active" : "pending", // ✅ SET STATUS BASED ON MANDATE
              mandateStatus: mandateStatus, // ✅ STORE MANDATE STATUS
              activeDate: mandateStatus === "active" ? new Date() : null, // ✅ SET ACTIVE DATE IF ACTIVE
            },
          },
        }
      );

      // Verify the update worked
      const updatedFamily = await familiesCollection.findOne({
        _id: new ObjectId(familyId),
      });
    } else {
      console.log("❌ Payment method is not bacs_debit:", paymentMethod.type);
    }
  } catch (error) {
    console.error("❌ Error processing setup intent:", error);
  }
}

// ✅ NEW FUNCTION: Handle mandate status updates
async function handleMandateUpdate(mandate) {
  try {
    if (!familiesCollection) {
      return;
    }

    // Find family by mandate ID
    const family = await familiesCollection.findOne({
      "directDebit.stripeMandateId": mandate.id,
    });

    if (!family) {
      return;
    }

    const updateData = {
      "directDebit.mandateStatus": mandate.status,
    };

    // If mandate becomes active, update the main status and set active date
    if (mandate.status === "active") {
      updateData["directDebit.status"] = "active";
      updateData["directDebit.activeDate"] = new Date();
    }
    // If mandate is revoked or failed, update status accordingly
    else if (mandate.status === "inactive" || mandate.status === "revoked") {
      updateData["directDebit.status"] = "cancelled";
    }

    const result = await familiesCollection.updateOne(
      { _id: family._id },
      { $set: updateData }
    );
  } catch (error) {
    console.error("❌ Error handling mandate update:", error);
  }
}
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
    const studentsCollection = client.db("alyaqeenDb").collection("students");
    familiesCollection = client.db("alyaqeenDb").collection("families");
    const feesCollection = client.db("alyaqeenDb").collection("fees");
    const teachersCollection = client.db("alyaqeenDb").collection("teachers");
    const prayerTimesCollection = client
      .db("alyaqeenDb")
      .collection("prayer-times");
    const departmentsCollection = client
      .db("alyaqeenDb")
      .collection("departments");
    const classesCollection = client.db("alyaqeenDb").collection("classes");
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
    app.post("/create-bacs-checkout-session", async (req, res) => {
      try {
        const { email, familyId, name } = req.body; // ✅ Get name from request body

        // ✅ STEP 1: Create or retrieve Stripe Customer
        let customer;

        // Check if customer already exists by email
        const existingCustomers = await stripe.customers.list({
          email: email,
          limit: 1,
        });

        if (existingCustomers.data.length > 0) {
          customer = existingCustomers.data[0];

          // ✅ UPDATE: If customer exists but name is different, update it
          if (name && customer.name !== name) {
            customer = await stripe.customers.update(customer.id, {
              name: name,
            });
          }
        } else {
          // Create new customer WITH ACTUAL NAME
          customer = await stripe.customers.create({
            email: email,
            name: name, // ✅ Use the actual name from checkout form
            metadata: {
              familyId: familyId,
              source: "bacs_direct_debit_setup",
            },
          });
        }

        // ✅ STEP 2: Create Checkout Session WITH customer ID
        const session = await stripe.checkout.sessions.create({
          mode: "setup",
          payment_method_types: ["bacs_debit"],
          customer: customer.id, // ← CRITICAL: Link to customer
          success_url:
            "http://localhost:5173/dashboard/parent/payment-success?session_id={CHECKOUT_SESSION_ID}",
          cancel_url: "http://localhost:5173/dashboard/parent/payment-cancel",
          metadata: {
            familyId: familyId,
            customerId: customer.id,
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
  if (currentDay === 10) reminderDay = 10;
  else if (currentDay === 20) reminderDay = 20;
  else if (currentDay === 29) reminderDay = 29;
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
