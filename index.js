require("dotenv").config();
const express = require("express");
const cors = require("cors");

const port = process.env.PORT || 9000;
const app = express();

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

    app.patch("/students/:id", async (req, res) => {
      const id = req.params.id;
      const updates = req.body;

      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {},
      };

      if (updates.status !== undefined) {
        updateDoc.$set.status = updates.status;
      }
      if (updates.class !== undefined) {
        updateDoc.$set["academic.class"] = updates.class; // ✅ correct nested update
      }

      if (Object.keys(updateDoc.$set).length === 0) {
        return res
          .status(400)
          .send({ message: "No valid fields provided to update." });
      }

      const result = await studentsCollection.updateOne(query, updateDoc);
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
