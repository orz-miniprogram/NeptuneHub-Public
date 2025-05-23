const mongoose = require('mongoose');

const PayoutSchema = new mongoose.Schema({
  runner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0.01, // Minimum payout amount
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'successful', 'failed', 'canceled'],
    default: 'pending',
    required: true,
  },
  wechatOpenId: {
    type: String,
    required: true,
  },
  partnerTradeNo: { // Unique ID for WeChat Pay payout
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  wechatPaymentNo: { // WeChat's transaction ID for the payout
    type: String,
    sparse: true, // Can be null until payment is processed
  },
  description: {
    type: String,
    default: 'Runner payout',
  },
  failureReason: { // Store reason if payout fails
    type: String,
  },
  initiatedAt: {
    type: Date,
    default: Date.now,
  },
  completedAt: {
    type: Date,
  },
});

PayoutSchema.pre('save', function (next) {
  if (this.isModified('status') && this.status === 'successful' || this.status === 'failed') {
    this.completedAt = Date.now();
  }
  next();
});

module.exports = mongoose.model('Payout', PayoutSchema);
