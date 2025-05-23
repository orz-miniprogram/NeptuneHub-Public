// models/Resource.js
const mongoose = require('mongoose');

const ResourceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  description: {
    type: String
  },
  category: {
    type: String, required: true  // e.g., "Electronics", "Books", or granular errand types like "takeout", "package"
  },
  specifications: {
    type: mongoose.Schema.Types.Mixed,
    default: {} // Good practice to have a default empty object
  },
  price: {
    type: Number,
    required: true  // Price the seller is asking for (or buyer's max price)
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true  // User's ID (either buyer or seller)
  },
  type: {
    type: String,
    enum: ['buy', 'sell', 'rent', 'lease', 'service-request', 'service-offer'],
    required: true
  },
  status: {
    type: String,
    enum: ['submitted', 'matching', 'matched', 'canceled'],
    default: 'matching',
    required: true
  },
  media: [
    {
      type: String, // Store an array of filenames or paths
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now
  },
  // If this 'service-request' Resource was generated from a broader Match (e.g., for delivery of a bought item)
  originatingMatchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Match',
    default: null
  },
  // --- Fields related to matching assignment (Added back as discussed) ---
  assignedErrandId: { // Links to the Errand document if this resource is an errand request/offer
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Errand'
  },
  assignedMatchId: { // Links to the Match document if this resource is part of a general buy/sell/rent/lease match
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Match'
  },
  // --- Field to track matching attempts (Added back as discussed) ---
  matchAttempts: {
    type: Number,
    default: 0,
    min: 0 // Ensures it's not negative
  },
  // 'potentialOfferResources' and 'lastPotentialMatchUpdate' have been removed as per earlier discussion.
  refundRequestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RefundRequest', // Reference to the RefundRequest model
    required: false, // It's optional because not all resources will have a refund request
    description: 'ID of the last initiated or active refund request associated with this resource.',
  },
});

// Add indexes (after the schema definition)
ResourceSchema.index({ type: 1, category: 1 }); // Index for filtering by type and category
ResourceSchema.index({ name: 1 }); // Index for searching by name
ResourceSchema.index({ price: 1 }); // Index for filtering/sorting by price

module.exports = mongoose.model('Resource', ResourceSchema);
