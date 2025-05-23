// models/Address.js
const mongoose = require('mongoose');

const AddressSchema = new mongoose.Schema({
  district: {
    type: Number, // Use Number type based on your data (1, 2, 3, 4)
    enum: [1, 2, 3, 4], // Updated districts based on your list
    required: true,
  },
  building: {
    type: String, // Keep as String if storing the building name or ID string
    required: true // Assuming building is required for a specific location point
  },
  unitDetails: {
    type: String,
    required: false
  }
}, { _id: false }); // Don't create a separate _id for embedded documents

module.exports = AddressSchema; // Export the schema itself
