const express = require("express");
const router = express.Router();
const Car = require("../models/Car");

router.get("/", async (req, res) => {
  try {
    const cars = await Car.find({ isAvailable: true });
    res.json(cars);
  } catch (error) {
    res.status(500).json({ message: "Failed to load cars" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const car = await Car.findById(req.params.id);
    if (!car) {
      return res.status(404).json({ message: "Car not found" });
    }
    res.json(car);
  } catch (error) {
    res.status(404).json({ message: "Car not found" });
  }
});

module.exports = router;
