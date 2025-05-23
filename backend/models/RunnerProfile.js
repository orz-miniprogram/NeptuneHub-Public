// models/RunnerProfile.js
const mongoose = require('mongoose');

const RunnerProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true // Ensures one profile per user
  },
  // --- Performance & Reputation (These are general and useful for matching/trust) ---
  ratings: {
    average: { type: Number, default: 0, min: 0, max: 5 },
    count: { type: Number, default: 0 }
  },
  completedErrandsCount: { type: Number, default: 0 },
  cancellationRate: { type: Number, default: 0 }, // Percentage

  // --- Matching Cache (Kept as this is crucial for the matching job functionality) ---
  potentialErrandRequests: [{
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource' },
    score: { type: Number },
    matchedAt: { type: Date, default: Date.now }
  }],
  lastPotentialMatchUpdate: { type: Date }, // Timestamp of the last time this runner's cache was updated

  // Removed: vehicleType, cargoCapacityDescription, specialEquipment,
  // operatingCampusZones, preferredOperatingHours (These details can now be managed on the individual Resource/Offer page)

}, { timestamps: true }); // Mongoose adds createdAt and updatedAt

module.exports = mongoose.model('RunnerProfile', RunnerProfileSchema);
