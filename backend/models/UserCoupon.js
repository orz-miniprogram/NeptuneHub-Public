// models/UserCoupon.js (Example Schema)
const mongoose = require('mongoose');

const UserCouponSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }, // Link to the user
    coupon: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon', required: true, index: true }, // Link to the coupon type
    code: { type: String, required: true }, // Store the coupon code redundancy for easier lookup/display
    isUsed: { type: Boolean, default: false }, // Has this specific instance been used
    usedAt: { type: Date }, // When it was used
    orderUsedOn: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' }, // Which order it was used on
    assignedAt: { type: Date, default: Date.now }, // When the user received this coupon
});

// Optional: Add a unique compound index to ensure a user doesn't get the same coupon instance multiple times
// UserCouponSchema.index({ user: 1, coupon: 1 }, { unique: true });

module.exports = mongoose.model('UserCoupon', UserCouponSchema);