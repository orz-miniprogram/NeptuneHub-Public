// models/Errand.js
const mongoose = require('mongoose');
const AddressSchema = require('./Address'); // Import the base AddressSchema
const AppliedCouponDataSchema = require('./Coupon');// Import the schema

const ErrandSchema = new mongoose.Schema({
  // Direct link to the originating 'service-request' Resource.
  // This Resource could be user-created or generated from a Match.
  resourceRequestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Resource', // This MUST be a 'service-request' type resource
    required: false,
    unique: true, // Ensures only one Errand document per unique service-request Resource
  },

  // --- Fields for Send to Door (送货上门) Feature ---
  isDeliveryToDoor: {
    type: Boolean,
    default: false
  },
  deliveryFee: {
    type: Number,
    default: 0
  },
  requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Assuming Errand has a requester field
  basePrice: { type: Number, required: true }, // The base price for the errand, set when it's created

  totalAmount: {
    type: Number,
    required: true,
    // default: function() { return this.basePrice; } // Initialize with basePrice on creation
  },
  finalAmount: {
    type: Number,
    required: true,
    // default: function() { return this.totalAmount; } // Initialize with totalAmount on creation
  },

  // New field to embed the coupon application details
  couponApplication: new mongoose.Schema(AppliedCouponDataSchema.obj, { _id: false }),
  // Number of units (e.g., floors) involved in the door delivery effort
  doorDeliveryUnits: {
    type: Number,
    required: function () { return this.isDeliveryToDoor === true; }
  },

  // --- Timeframe ---
  expectedStartTime: { type: Date, required: false },
  expectedEndTime: { type: Date, required: false },
  expectedTimeframeString: { type: String, required: false },

  // --- Errand Fulfillment Status and Runner ---
  currentStatus: {
    type: String,
    enum: [
      'pending',        // Runner has been identified and notified, awaiting their acceptance
      'assigned',       // Runner has been matched/assigned
      'picked_up',
      'dropped_off',
      'completed',
      'cancelled',
      'expired'
    ],
    default: 'pending'
  },
  errandRunner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null // Null until assigned
  },
  runnerAssignedAt: { type: Date, default: null },

  // --- Proofs ---
  pickupProofUrl: { type: String, default: null },
  dropoffProofUrl: { type: String, default: null },

  // --- Locations ---
  pickupLocation: {
    type: AddressSchema,
    required: true
  },
  dropoffLocation: {
    type: AddressSchema,
    required: true
  },

  // --- Timestamps ---
  pickedUpAt: { type: Date, default: null },
  droppedOffAt: { type: Date, default: null },
  assignedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  cancelledAt: { type: Date, default: null },

  refundRequestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RefundRequest', // Reference to the RefundRequest model
    required: false,
    description: 'ID of the last initiated or active refund request associated with this errand.',
  },

}, { timestamps: true });

// Ensure unique index for resourceRequestId
ErrandSchema.index({ resourceRequestId: 1 }, { unique: true });
ErrandSchema.index({ currentStatus: 1 });
ErrandSchema.index({ errandRunner: 1, currentStatus: 1 });
ErrandSchema.index({ 'pickupLocation.district': 1, currentStatus: 1 });
ErrandSchema.index({ 'dropoffLocation.district': 1, currentStatus: 1 });

module.exports = mongoose.model('Errand', ErrandSchema);
