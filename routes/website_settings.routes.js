const express = require("express");
const router = express.Router();
const { ObjectId } = require("mongodb");

module.exports = (websiteSettingsCollection) => {
  const SETTINGS_ID = "6947d4dfbe203471d9bb0ff1"; // Your existing ID

  // GET all settings - return single document or create if not exists
  router.get("/", async (req, res) => {
    try {
      // Try to get existing document
      let settings = await websiteSettingsCollection.findOne({
        _id: new ObjectId(SETTINGS_ID),
      });

      // If not found, check if collection is empty
      if (!settings) {
        // Check if there's any document (maybe with different ID)
        const allSettings = await websiteSettingsCollection.find().toArray();

        if (allSettings.length > 0) {
          // Use the first existing document
          settings = allSettings[0];
        } else {
          // Create default document with your existing ID structure
          const defaultSettings = {
            _id: new ObjectId(SETTINGS_ID),
            bestTeacher: {},
            bestStudent: {},
            homeVideo: {},
            prayerCalendar: {},
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          await websiteSettingsCollection.insertOne(defaultSettings);
          settings = defaultSettings;
        }
      }

      res.json({ success: true, data: settings });
    } catch (error) {
      console.error("Error fetching settings:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // UPDATE specific section
  router.patch("/:section", async (req, res) => {
    try {
      const { section } = req.params;
      const updateData = req.body;

      // Validate section
      const validSections = [
        "bestTeacher",
        "bestStudent",
        "homeVideo",
        "prayerCalendar",
      ];

      if (!validSections.includes(section)) {
        return res.status(400).json({
          success: false,
          message: "Invalid section",
        });
      }

      const result = await websiteSettingsCollection.updateOne(
        { _id: new ObjectId(SETTINGS_ID) },
        {
          $set: {
            [section]: updateData,
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );

      res.json({
        success: true,
        message: `${section} updated successfully`,
        data: result,
      });
    } catch (error) {
      console.error("Error updating section:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // UPDATE entire settings
  router.put("/", async (req, res) => {
    try {
      const settingsData = req.body;

      const result = await websiteSettingsCollection.updateOne(
        { _id: new ObjectId(SETTINGS_ID) },
        {
          $set: {
            ...settingsData,
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );

      res.json({
        success: true,
        message: "Settings updated successfully",
        data: result,
      });
    } catch (error) {
      console.error("Error updating settings:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // GET specific section
  router.get("/:section", async (req, res) => {
    try {
      const { section } = req.params;

      const settings = await websiteSettingsCollection.findOne(
        { _id: new ObjectId(SETTINGS_ID) },
        { projection: { [section]: 1, _id: 0 } }
      );

      if (!settings || !settings[section]) {
        return res.json({ success: true, data: {} });
      }

      res.json({ success: true, data: settings[section] });
    } catch (error) {
      console.error("Error fetching section:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // DELETE specific section (reset to empty)
  router.delete("/:section", async (req, res) => {
    try {
      const { section } = req.params;

      const result = await websiteSettingsCollection.updateOne(
        { _id: new ObjectId(SETTINGS_ID) },
        {
          $set: {
            [section]: {},
            updatedAt: new Date(),
          },
        }
      );

      res.json({
        success: true,
        message: `${section} cleared successfully`,
      });
    } catch (error) {
      console.error("Error deleting section:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  return router;
};
