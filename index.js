require("dotenv").config();
const express = require("express");
const cors = require("cors");

const port = process.env.PORT || 9000;
const app = express();
const admin = require("firebase-admin");
const serviceAccount = require("./alyaqeen-62c18-firebase-adminsdk-fbsvc-1b71e1f5e6.json");

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

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
};
//localhost:5000 and localhost:5173 are treated as same site.  so sameSite value must be strict in development server.  in production sameSite will be none
// in development server secure will false .  in production secure will be true

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_User}:${process.env.DB_Pass}@cluster0.dr5qw.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // collections
    const usersCollection = client.db("alyaqeenDb").collection("users");
    const studentsCollection = client.db("alyaqeenDb").collection("students");
    const notificationsCollection = client
      .db("alyaqeenDb")
      .collection("notifications");

    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const result = await usersCollection.findOne(query);
      res.send({ role: result?.role });
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

    // posting users here
    app.post("/users", async (req, res) => {
      const newUser = req.body;
      const result = await usersCollection.insertOne(newUser);
      res.send(result);
    });

    // posting students whole data here
    app.post("/students", async (req, res) => {
      const newStudent = req.body;
      const result = await studentsCollection.insertOne(newStudent);
      res.send(result);
    });

    // getting users here
    app.get("/users", async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });
    // getting students here
    app.get("/students", async (req, res) => {
      const result = await studentsCollection.find().toArray();
      res.send(result);
    });
    // getting single students here
    app.get("/students/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const student = await studentsCollection.findOne(query);
      res.send(student);
    });
    // deleting single student here
    app.delete("/students/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await studentsCollection.deleteOne(query);
      res.send(result);
    });

    // student update
    app.put("/student/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const studentData = req.body;
      const updatedDoc = {
        $set: { ...studentData },
      };
      const result = await studentsCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    // status update
    app.patch("/student/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const { status } = req.body;
      const updatedDoc = {
        $set: { status },
      };
      try {
        const result = await studentsCollection.updateOne(query, updatedDoc);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to update student status." });
      }
    });

    // notification load
    app.post("/notifications", async (req, res) => {
      const notification = req.body;
      const result = await notificationsCollection.insertOne(notification);
      res.send(result);
    });
    app.get("/notifications", async (req, res) => {
      const result = await notificationsCollection.find().toArray();
      res.send(result);
    });

    app.get("/notifications/unread", async (req, res) => {
      try {
        const result = await notificationsCollection
          .find({ isRead: false })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ success: false, message: "Server error" });
      }
    });

    app.patch("/notifications/:id", async (req, res) => {
      const id = req.params.id;
      const result = await notificationsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { isRead: true } }
      );
      res.send(result);
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
