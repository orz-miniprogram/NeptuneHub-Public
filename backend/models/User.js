// models/User.js
const mongoose = require('mongoose');
const AddressSchema = require('./Address'); // Import the base AddressSchema
const RunnerProfile = require('./RunnerProfile'); // Import the RunnerProfile model

const UserSchema = new mongoose.Schema({
  studentId: { type: String, required: true, unique: true, index: true },
  displayName: { type: String },
  // Using the imported AddressSchema for user's saved addresses
  addresses: [AddressSchema],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },

  credits: {
    type: Number,
    default: 80,
    required: true, // Marking as required as per your request
    min: 0
  },
  points: {
    type: Number,
    default: 0,
    required: true, // Marking as required as per your request
    min: 0
  },

  // --- Runner Role & Profile Link (Using the more complete definition) ---
  isRunner: {
    type: Boolean,
    default: false // Defaults to not a runner
  },
  runnerProfile: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RunnerProfile',
    unique: true,
    sparse: true, // Crucial: Allows users who are NOT runners to omit this field without unique index issues
    // Custom validator: runnerProfile is required ONLY if isRunner is true
    validate: {
      validator: function (value) {
        // If `isRunner` is true for the current document, `runnerProfile` must have a value.
        // If `isRunner` is false, this validation passes regardless of `runnerProfile`'s value (can be null/undefined).
        return !this.isRunner || (value !== null && value !== undefined);
      },
      message: 'Runner profile is required for users marked as a runner.'
    }
  },
  // --- Wallet Link (New addition) ---
  wallet: { // Link to the user's wallet
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Wallet',
    unique: true, // A user should only have one wallet
    sparse: true // Allows users without a wallet initially
  },
});

UserSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

UserSchema.index({ studentId: 1 });
UserSchema.index({ isRunner: 1, credits: 1 }); // Ensure this index is still relevant after adding credits
UserSchema.index({ 'addresses.district': 1 });

module.exports = mongoose.model('User', UserSchema);
