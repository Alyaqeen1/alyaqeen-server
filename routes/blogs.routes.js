const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");
// Helper function to create URL-friendly slug
const createSlug = (text) => {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "") // Remove special characters
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .trim();
};
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
        .sort({ createdAt: -1 }) // Sort by date descending
        .limit(1) // Get only one
        .toArray();

      res.send(result[0] || null);
    } catch (error) {
      res
        .status(500)
        .send({ message: "Failed to fetch latest blog", error: error.message });
    }
  });

  // GET single blog by slug
  router.get("/slug/:slug", async (req, res) => {
    try {
      const slug = req.params.slug;
      const query = { slug: slug };
      const result = await blogsCollection.findOne(query);

      if (!result) {
        return res.status(404).send({ message: "Blog not found" });
      }
      res.send(result);
    } catch (error) {
      res.status(500).send({
        message: "Failed to fetch blog by slug",
        error: error.message,
      });
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
  // router.post("/", async (req, res) => {
  //   try {
  //     const newBlog = {
  //       ...req.body,
  //       createdAt: new Date(),
  //       updatedAt: new Date(),
  //     };
  //     const result = await blogsCollection.insertOne(newBlog);
  //     res.status(201).send(result);
  //   } catch (error) {
  //     res
  //       .status(500)
  //       .send({ message: "Failed to create blog", error: error.message });
  //   }
  // });

  // POST create new blog
  router.post("/", async (req, res) => {
    try {
      const { title, ...rest } = req.body;

      // Generate base slug from title if not provided
      let baseSlug = req.body.slug || createSlug(title);

      // Check for existing slugs and make it unique
      let slug = baseSlug;
      let counter = 1;

      while (true) {
        const existingBlog = await blogsCollection.findOne({ slug });
        if (!existingBlog) {
          break; // Slug is unique
        }
        // Append counter and increment
        slug = `${baseSlug}-${counter}`;
        counter++;
      }

      const newBlog = {
        title,
        slug,
        ...rest,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await blogsCollection.insertOne(newBlog);
      res.status(201).send({
        ...result,
        blog: newBlog,
        message: "Blog created successfully with unique slug",
      });
    } catch (error) {
      res
        .status(500)
        .send({ message: "Failed to create blog", error: error.message });
    }
  });

  // PUT update blog by ID
  // router.put("/:id", async (req, res) => {
  //   try {
  //     const id = req.params.id;
  //     const query = { _id: new ObjectId(id) };

  //     // Check if blog exists
  //     const existingBlog = await blogsCollection.findOne(query);
  //     if (!existingBlog) {
  //       return res.status(404).send({ message: "Blog not found" });
  //     }

  //     const updateData = {
  //       ...req.body,
  //       updatedAt: new Date(),
  //     };

  //     const updateDoc = {
  //       $set: updateData,
  //     };

  //     const result = await blogsCollection.updateOne(query, updateDoc);

  //     if (result.modifiedCount === 1) {
  //       res.send({ message: "Blog updated successfully", ...result });
  //     } else {
  //       res.status(400).send({ message: "Failed to update blog" });
  //     }
  //   } catch (error) {
  //     res
  //       .status(400)
  //       .send({ message: "Invalid blog ID or request", error: error.message });
  //   }
  // });

  // PUT update blog by ID
  // PUT update blog by ID - FIXED VERSION
  router.put("/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      // Check if blog exists
      const existingBlog = await blogsCollection.findOne(query);
      if (!existingBlog) {
        return res.status(404).send({ message: "Blog not found" });
      }

      // Handle slug generation from title if title is changed
      const updateData = { ...req.body, updatedAt: new Date() };

      // If title is being changed, generate new slug from new title
      if (updateData.title && updateData.title !== existingBlog.title) {
        let baseSlug = createSlug(updateData.title);
        let slug = baseSlug;
        let counter = 1;

        // Check for existing slugs and make it unique
        while (true) {
          const otherBlog = await blogsCollection.findOne({
            slug,
            _id: { $ne: new ObjectId(id) }, // Exclude current blog
          });

          if (!otherBlog) {
            break; // Slug is unique
          }
          slug = `${baseSlug}-${counter}`;
          counter++;
        }

        updateData.slug = slug;
      }
      // If slug is explicitly provided, handle its uniqueness
      else if (updateData.slug && updateData.slug !== existingBlog.slug) {
        let baseSlug = updateData.slug;
        let slug = baseSlug;
        let counter = 1;

        while (true) {
          const otherBlog = await blogsCollection.findOne({
            slug,
            _id: { $ne: new ObjectId(id) }, // Exclude current blog
          });

          if (!otherBlog) {
            break; // Slug is unique
          }
          slug = `${baseSlug}-${counter}`;
          counter++;
        }

        updateData.slug = slug;
      }

      const updateDoc = {
        $set: updateData,
      };

      const result = await blogsCollection.updateOne(query, updateDoc);

      if (result.modifiedCount === 1) {
        const updatedBlog = await blogsCollection.findOne(query);
        res.send({
          message: "Blog updated successfully",
          updatedBlog: updatedBlog,
          ...result,
        });
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
