// models/Coupon.js (Example Schema)
const mongoose = require('mongoose');

const AppliedCouponDataSchema = new mongoose.Schema({
  // Reference to the actual Coupon document that was applied
  couponId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Coupon',
    required: true
  },
  // Store the coupon code directly for quick access without needing to populate
  couponCode: {
    type: String,
    required: true
  },
  // The calculated discount amount for this specific transaction
  discountAmount: {
    type: Number,
    required: true,
    min: 0
  },
  // Timestamp when the coupon was applied to the transaction
  appliedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false }); // _id: false means Mongoose won't create a default _id for this sub-document

module.exports = AppliedCouponDataSchema;

const CouponSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true, index: true }, // e.g., "SAVE10PERCENT"
    description: { type: String }, // e.g., "10% off your next order"
    discountType: { type: String, required: true, enum: ['percentage', 'fixed_amount'] }, // Type of discount
    discountValue: { type: Number, required: true, min: 0 }, // e.g., 10 for 10%, or 5 for $5 off
    minimumOrderAmount: { type: Number, default: 0, min: 0 }, // Minimum order total to apply
    expiryDate: { type: Date }, // When the coupon expires
    usageLimit: { type: Number, default: 1 }, // How many times a single coupon code can be used in total
    perUserLimit: { type: Number, default: 1 }, // How many times a single user can use this coupon code
    applicableItems: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Resource' }], // Coupons applicable to specific resources
    isActive: { type: Boolean, default: true }, // Is the coupon currently active
    createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Coupon', CouponSchema);
