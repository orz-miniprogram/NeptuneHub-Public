// ./models/Match.js
const mongoose = require('mongoose');
const AppliedCouponDataSchema = require('./Coupon');
const Resource = require('../models/Resource');
const Errand = require('../models/Errand');
const User = require('../models/User');

const MatchSchema = new mongoose.Schema({
  // References to the resources involved in the match
  resource1: { // Typically the Requester's resource
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Resource',
    required: true
  },
  resource2: { // Typically the Owner's resource
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Resource',
    required: true
  },

  // References to the users involved (Requester and Owner)
  requester: { // The user who initiated the resource type (e.g., 'buy', 'service-request')
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  owner: { // The user who owns the resource being sought (e.g., 'sell', 'service-offer')
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Match Score (from the matching algorithm)
  score: {
    type: Number,
    required: true
  },

  // --- Negotiation Fields ---

  // Suggested prices calculated by the worker based on the other party's price + errand fee
  // These are the prices users are prompted to accept first
  suggestedPriceRequester: { // Suggested price the Requester should pay
    type: Number,
    required: false // Not required if calculation fails or not applicable
  },
  suggestedPriceOwner: { // Suggested price the Owner should receive
    type: Number,
    required: false // Not required if calculation fails or not applicable
  },

  // Original prices from the matched resources at the time of matching
  // These are the fallback prices if suggested price window expires
  originalPriceRequester: { // Original price of resource1 (Requester's resource)
    type: Number,
    required: false // Assuming price might be optional on Resource sometimes
  },
  originalPriceOwner: { // Original price of resource2 (Owner's resource)
    type: Number,
    required: false // Assuming price might be optional on Resource sometimes
  },


  // Timestamp when the FIRST user accepted the suggested price
  // This starts the 1-day Acceptance Window for the second user
  firstAcceptanceTime: {
    type: Date,
    default: null // Default to null until the first acceptance happens
  },

  // Flags to track if users have accepted the suggested price
  requesterAcceptedSuggestedPrice: {
    type: Boolean,
    default: false
  },
  ownerAcceptedSuggestedPrice: {
    type: Boolean,
    default: false
  },

  // Flags to track if users have accepted the original price (Keeping for schema consistency, although less used in the simplified model)
  requesterAcceptedOriginalPrice: {
    type: Boolean,
    default: false
  },
  ownerAcceptedOriginalPrice: {
    type: Boolean,
    default: false
  },


  // --- Final Price Fields ---
  // These are set only when the match status becomes 'accepted'
  // They will store either the suggested or original prices based on acceptance
  resource1Payment: { // Final price the Requester (resource1) agrees to pay
    type: Number,
    required: false // Not required when status is 'pending' or 'cancelled'
  },
  resource2Receipt: { // Final price the Owner (resource2) agrees to receive
    type: Number,
    required: false // Not required when status is 'pending' or 'cancelled'
  },

  // --- Core Match Price Fields ---
  agreedPrice: { // The base price negotiated for the matched service/item
    type: Number,
    required: true,
    min: 0
  },
  deliveryFee: { // Additional fee specifically for delivery, if applicable
    type: Number,
    default: 0,
    min: 0
  },

  // --- Calculated Price Fields (Affected by Coupons, etc.) ---
  // These are derived from agreedPrice + deliveryFee, and then adjusted by coupons
  totalAmount: { // The total amount *before* any coupon discount (agreedPrice + deliveryFee)
    type: Number,
    required: true,
    min: 0,
    // Default function to ensure it's calculated on creation based on agreedPrice and deliveryFee
    default: function () { return this.agreedPrice + (this.deliveryFee || 0); }
  },
  finalAmount: { // The final amount to be paid by the requester (totalAmount - discountAmount)
    type: Number,
    required: true,
    min: 0,
    // Default function to ensure it's initialized correctly
    default: function () { return this.totalAmount; } // Initially same as totalAmount
  },
  // --- Coupon Application Details ---
  couponApplication: new mongoose.Schema(AppliedCouponDataSchema.obj, { _id: false }),


  // --- Status and Cancellation ---
  // Simplified status enum based on our discussion
  // Removed 'declined' and specific window statuses like 'negotiation_window', 'acceptance_window'
  status: {
    type: String,
    enum: ['pending', 'accepted', 'paid', 'erranding', 'completed', 'cancelled'],
    default: 'pending',
    required: true
  },

  // --- Reference to the Errand document ---
  serviceRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Resource',
    default: null // Null until an errand is created for this match
  },

  // Reason for cancellation (if status is 'cancelled')
  cancellationReason: {
    type: String,
    // Required only if the status is 'cancelled'
    required: function () {
      return this.status === 'cancelled';
    },
    default: null // Default to null, not undefined
  },

  // User who initiated the rejection/cancellation (optional)
  rejectedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null // Default to null if cancelled automatically or by timeout
  },

  refundRequestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RefundRequest', // Reference to the RefundRequest model
    required: false,
    description: 'ID of the last initiated or active refund request associated with this match.',
  },

  // User who receives the penalty if the match times out
  timeoutPenaltyAppliedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null // Default to null if no penalty applied
  },


  // --- Timestamps ---
  createdAt: {
    type: Date,
    default: Date.now // Timestamp of match creation
  },
  updatedAt: { // Add an update timestamp to track last modification
    type: Date,
    default: Date.now // Automatically updated on save by pre-save hook
  }
});

// Add an index for faster lookup by status (useful for background task)
MatchSchema.index({ status: 1 });

// Add an index for finding pending matches with first acceptance time set (for background timeout task)
MatchSchema.index({ status: 1, firstAcceptanceTime: 1 });


// Add a pre-save hook to update the 'updatedAt' field on every save
MatchSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});


module.exports = mongoose.model('Match', MatchSchema);
