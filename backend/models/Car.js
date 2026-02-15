const mongoose = require("mongoose");
const ALLOWED_CAR_LOCATIONS = [
  "Ahmedabad",
  "Surat",
  "Vadodara",
  "Rajkot",
  "Gandhinagar",
  "Jamnagar",
];

const carSchema = new mongoose.Schema(
  {
    // Basic info
    name: {
      type: String,
      required: true
    },
    brand: {
      type: String,
      required: true
    },
    model: {
      type: String,
      required: true
    },
    category: {
      type: String, // SUV, Sedan, Hatchback
      required: true
    },

    // Specs
    year: {
      type: Number,
      required: true
    },
    seating_capacity: {
      type: Number,
      required: true
    },
    fuel_type: {
      type: String, // Petrol, Diesel, EV
      required: true
    },
    transmission: {
      type: String, // Manual / Automatic
      required: true
    },

    // Location
    location: {
      type: String,
      required: true,
      trim: true,
      enum: {
        values: ALLOWED_CAR_LOCATIONS,
        message: "Location must be one of: Ahmedabad, Surat, Vadodara, Rajkot, Gandhinagar, Jamnagar",
      },
    },

    // Pricing & availability
    pricePerDay: {
      type: Number,
      required: true
    },
    isAvailable: {
      type: Boolean,
      default: true
    },

    // Media
    image: {
      type: String,
      required: true
    },
    imagePublicId: {
      type: String,
      default: ''
    },
    features: {
      type: [String],
      required: true,
      validate: [arr => arr.length >= 5, "At least 5 features required"]
    }    
  },
  { timestamps: true }
);

module.exports = mongoose.model("Car", carSchema);
