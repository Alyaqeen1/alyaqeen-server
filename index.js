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

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

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
    const familiesCollection = client.db("alyaqeenDb").collection("families");
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
        groupsCollection
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
      createLessonsCoveredRouter(lessonsCoveredCollection)
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

app.get("/", async (req, res) => {
  res.send("Alyaqeen server is running");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
