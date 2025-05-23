// models/PotentialMatchCache.js
const mongoose = require('mongoose');

const PotentialMatchCacheSchema = new mongoose.Schema({
  resourceId: { // The ID of the Resource for which these potential matches exist
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Resource',
    required: true,
    unique: true // Ensures only one cache entry per Resource
  },
  potentialMatches: [{ // Array of potential matched resources or relevant match data
    matchedResourceId: { // The ID of the resource that is a potential match
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Resource',
      required: true
    },
    score: { // Match score for this potential match
      type: Number,
      required: true
    },
    // Add any other relevant cached data for the match here, e.g., calculated price, estimated errand time
    cachedData: mongoose.Schema.Types.Mixed
  }],
  lastCacheUpdate: { // Timestamp of when this cache entry was last updated
    type: Date,
    default: Date.now
  }
}, { timestamps: true }); // Adds createdAt and updatedAt

module.exports = mongoose.model('PotentialMatchCache', PotentialMatchCacheSchema);
