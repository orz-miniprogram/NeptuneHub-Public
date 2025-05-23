// backend/models/RefundRequest.js

const mongoose = require('mongoose');

const refundRequestSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // Reference to your User model
    required: true,
    index: true, // Index for efficient lookup by user
    description: 'The user who initiated this refund request.',
  },
  // You need to link the refund request to the specific item it relates to.
  // Make these optional, as a refund might primarily target one type (e.g., an errand).
  // You'll typically only populate one of these based on the context of the refund request.
  resourceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Resource', // Reference to your Resource model (for rent/lease or general resources)
    required: false,
    index: true, // Index for efficient lookup
    description: 'The ID of the Resource related to the refund request (e.g., for renting/leasing).',
  },
  errandId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Errand', // Reference to your Errand model
    required: false,
    index: true, // Index for efficient lookup
    description: 'The ID of the Errand related to the refund request (e.g., for erranding services).',
  },
  matchId: { // This might be for specific assignments within an errand/resource if applicable
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Match', // Reference to your Match model (if matches have associated payments)
    required: false,
    index: true, // Index for efficient lookup
    description: 'The ID of the Match related to the refund request (e.g., specific service assignment).',
  },
  amount: {
    type: Number,
    required: true,
    min: 0, // Amount cannot be negative
    description: 'The total amount requested for refund. For now, this will be the full price.',
  },
  reason: {
    type: String,
    required: false, // User can optionally provide a reason
    trim: true,
    maxlength: 500, // Limit reason length
    description: 'The reason provided by the user for the refund request.',
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'processed', 'disputed'],
    default: 'pending',
    required: true,
    index: true, // Index for efficient status filtering
    description: 'The current status of the refund request. "Processed" means the funds have been returned.',
  },
  requestedAt: {
    type: Date,
    default: Date.now,
    description: 'Timestamp when the refund request was initiated by the user.',
  },
  approvedAt: {
    type: Date,
    required: false,
    description: 'Timestamp when the refund request was approved by an administrator/system.',
  },
  processedAt: {
    type: Date,
    required: false,
    description: 'Timestamp when the refund funds were actually returned to the user\'s wallet.',
  },
  rejectedAt: {
    type: Date,
    required: false,
    description: 'Timestamp when the refund request was rejected.',
  },
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // Reference to your User model (for admin/system user who processed)
    required: false, // Will be populated if processed by an admin
    description: 'The ID of the user (e.g., administrator) or system that approved/rejected/processed the request.',
  },
  adminNotes: {
    type: String,
    required: false,
    trim: true,
    description: 'Internal notes added by administrators regarding the refund request.',
  },
}, {
  timestamps: true, // Adds `createdAt` and `updatedAt` automatically
  collection: 'refund_requests', // Explicitly set collection name
});

// Optional: Add a pre-save hook or validation to ensure only one associated ID is present
// This can help maintain data integrity if a refund applies to only one type of item.
// Example:
refundRequestSchema.pre('validate', function (next) {
  const associatedIds = [this.resourceId, this.errandId, this.matchId].filter(id => id !== undefined && id !== null);
  if (associatedIds.length !== 1) {
    // If the refund applies to one primary item, ensure only one of these is set.
    // Adjust logic if a refund can span multiple items (less common).
    return next(new Error('A refund request must be associated with exactly one resource, errand, or match ID.'));
  }
  next();
});


module.exports = mongoose.model('RefundRequest', refundRequestSchema);
