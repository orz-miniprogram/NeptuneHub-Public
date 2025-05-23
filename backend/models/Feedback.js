// models/Feedback.js
const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User', // Assuming you have a User model
        required: true,
    },
    orderId: { // Optional, for order disputes
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Resource', // Assuming 'Resource' is your order/job model
        required: false,
    },
    subject: {
        type: String,
        required: true,
        trim: true,
    },
    message: {
        type: String,
        required: true,
    },
    attachments: [{ // Array of file paths (local storage for now)
        type: String,
    }],
    status: {
        type: String,
        enum: ['pending', 'investigating', 'resolved', 'closed'],
        default: 'pending',
    },
    type: { // e.g., 'general_feedback', 'order_dispute', 'bug_report'
        type: String,
        required: true,
    },
}, { timestamps: true });

module.exports = mongoose.model('Feedback', feedbackSchema);
