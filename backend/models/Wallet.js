// models/Wallet.js
const mongoose = require('mongoose');

const WalletTransactionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['credit', 'debit'], // 'credit' for funds coming in, 'debit' for funds going out
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0 // Transactions should be positive amounts
  },
  description: {
    type: String,
    required: true // e.g., 'Errand Payout', 'Withdrawal', 'Top-up', 'Payment for Order'
  },
  referenceId: { // Optional: Link to the Errand ID, Payout ID, Match ID, etc.
    type: mongoose.Schema.Types.ObjectId,
    // No 'ref' specified here, as it could reference multiple models.
    // You'd typically use `sourceModel` in the payout endpoint if you need to link back
  },
  // If you need to know which model `referenceId` refers to, you'd add:
  referenceModel: {
    type: String,
    enum: ['Match', 'Payout', 'Resource', 'TopUp'], // Add other relevant models as needed
  },
  status: { // e.g., 'pending', 'completed', 'failed', 'reversed'
    type: String,
    enum: ['pending', 'completed', 'failed', 'reversed'],
    default: 'completed', // Most transactions will be completed immediately
    required: true
  },
  transactionFee: { type: Number, default: 0, min: 0 }, // Any fees charged for this transaction
  processedBy: { type: String } // e.g., 'System', 'WeChat Pay API', 'Bank API', 'Admin'
}, { timestamps: true }); // Adds createdAt and updatedAt to each transaction

const WalletSchema = new mongoose.Schema({
  userId: { // Changed from 'owner' to 'userId' for consistency
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  balance: {
    type: Number,
    default: 0,
    min: 0 // Balance cannot go negative unless you allow overdrafts
  },
  transactions: [WalletTransactionSchema] // Embedded array of transaction history
}, { timestamps: true }); // Adds createdAt and updatedAt to the wallet document itself

// No need for a pre('save') hook for updatedAt because 'timestamps: true' handles it.

module.exports = mongoose.model('Wallet', WalletSchema);
