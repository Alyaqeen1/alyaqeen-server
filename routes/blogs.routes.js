const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");

module.exports = (blogsCollection) => {
  // GET all blogs
  router.get("/", async (req, res) => {
    const result = await blogsCollection.find().toArray();
    res.send(result);
  });
  // Add to your backend routes
  router.get("/latest", async (req, res) => {
    try {
      const result = await blogsCollection
        .find()
        .sort({ date: -1, createdAt: -1 }) // Sort by date descending
        .limit(1) // Get only one
        .toArray();

      res.send(result[0] || null);
    } catch (error) {
      res
        .status(500)
        .send({ message: "Failed to fetch latest blog", error: error.message });
    }
  });
  // GET single blog by ID
  router.get("/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await blogsCollection.findOne(query);

      if (!result) {
        return res.status(404).send({ message: "Blog not found" });
      }
      res.send(result);
    } catch (error) {
      res.status(400).send({ message: "Invalid blog ID" });
    }
  });

  // POST create new blog
  router.post("/", async (req, res) => {
    try {
      const newBlog = {
        ...req.body,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const result = await blogsCollection.insertOne(newBlog);
      res.status(201).send(result);
    } catch (error) {
      res
        .status(500)
        .send({ message: "Failed to create blog", error: error.message });
    }
  });

  // PUT update blog by ID
  router.put("/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      // Check if blog exists
      const existingBlog = await blogsCollection.findOne(query);
      if (!existingBlog) {
        return res.status(404).send({ message: "Blog not found" });
      }

      const updateData = {
        ...req.body,
        updatedAt: new Date(),
      };

      const updateDoc = {
        $set: updateData,
      };

      const result = await blogsCollection.updateOne(query, updateDoc);

      if (result.modifiedCount === 1) {
        res.send({ message: "Blog updated successfully", ...result });
      } else {
        res.status(400).send({ message: "Failed to update blog" });
      }
    } catch (error) {
      res
        .status(400)
        .send({ message: "Invalid blog ID or request", error: error.message });
    }
  });

  // DELETE blog by ID
  router.delete("/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      // Check if blog exists
      const existingBlog = await blogsCollection.findOne(query);
      if (!existingBlog) {
        return res.status(404).send({ message: "Blog not found" });
      }

      const result = await blogsCollection.deleteOne(query);

      if (result.deletedCount === 1) {
        res.send({ message: "Blog deleted successfully", ...result });
      } else {
        res.status(400).send({ message: "Failed to delete blog" });
      }
    } catch (error) {
      res
        .status(400)
        .send({ message: "Invalid blog ID", error: error.message });
    }
  });

  return router;
};
