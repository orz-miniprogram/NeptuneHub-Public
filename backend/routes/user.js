// ./routes/user.js
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const fs = require('fs');

// Require your Mongoose models
const User = require('../models/User'); // Assuming User model is here
const Coupon = require('../models/Coupon'); // Assuming Coupon model is here
const UserCoupon = require('../models/UserCoupon'); // Assuming UserCoupon model is here
const Wallet = require('../models/Wallet');
const Feedback = require('../models/Feedback');

// Make sure your authentication middleware (e.g., authenticateToken) is defined
// Example: const { authenticateToken } = require('../middleware/auth');

// --- Protected Endpoint to Get Authenticated User's Coupons ---
// This endpoint assumes the authentication middleware has run and populated req.user
router.get('/coupons',
    // Apply your authentication middleware here if not applied globally
    // authenticateToken,
    async (req, res) => {
    // Get the authenticated user's ID from the token payload (populated by middleware)
    // Assuming your middleware puts the user's DB _id in req.user._id
    const userId = req.user._id;

    try {
        // Find UserCoupon documents for this user and populate the Coupon details
        const userCoupons = await UserCoupon.find({ user: userId })
                                           .populate('coupon'); // Populate the 'coupon' field

        // Filter coupons: only include valid, unused, and non-expired coupons
        const availableCoupons = userCoupons.filter(userCoupon => {
            const coupon = userCoupon.coupon; // The populated Coupon document

            // Check if the coupon itself is active and not expired
            const isCouponValid = coupon && coupon.isActive && (!coupon.expiryDate || new Date(coupon.expiryDate) > new Date());

            // Check if this specific user instance of the coupon has been used
            const isUserCouponUnused = !userCoupon.isUsed;

             // You might also need to check global usage limits on the Coupon model
             // and per-user limits (though per-user is tracked by isUsed on UserCoupon instances).
             // Implementing global usage limits requires more logic, e.g., counting total uses
             // associated with orders. For simplicity here, we focus on expiry and isUsed.

            return isCouponValid && isUserCouponUnused;
        });

        // Return the list of available coupons
        // You might want to shape the response data to include only necessary coupon details
        const responseCoupons = availableCoupons.map(userCoupon => ({
            _id: userCoupon._id, // The ID of the UserCoupon instance
            code: userCoupon.code, // The coupon code
            assignedAt: userCoupon.assignedAt, // When the user got it
            // Include details from the populated Coupon model:
            couponDetails: {
                _id: userCoupon.coupon._id, // The ID of the Coupon type
                description: userCoupon.coupon.description,
                discountType: userCoupon.coupon.discountType,
                discountValue: userCoupon.coupon.discountValue,
                minimumOrderAmount: userCoupon.coupon.minimumOrderAmount,
                expiryDate: userCoupon.coupon.expiryDate,
                // Exclude sensitive Coupon fields if any
            }
        }));


        res.status(200).json({
            message: 'User coupons fetched successfully',
            coupons: responseCoupons,
        });

    } catch (dbError) {
        console.error('Database error fetching user coupons:', dbError);
        res.status(500).json({ message: 'Failed to fetch user coupons.' });
    }
});

// GET /api/user/wallet
// Protected endpoint to fetch a user's wallet details (balance and transactions)
router.get('/wallet', async (req, res) => { // <--- NEW: Wallet route under /user
  try {
    const userId = req.user._id; // Assuming req.user is populated by your authentication middleware

    let wallet = await Wallet.findOne({ userId });

    // If wallet doesn't exist for the user (should ideally be created on user registration)
    if (!wallet) {
      console.warn(`Wallet not found for user ${userId}. Attempting to create one.`);
      wallet = new Wallet({ userId });
      await wallet.save();
      return res.status(200).json({
        balance: wallet.balance,
        transactions: [], // New wallet, no transactions yet
        message: 'Wallet created successfully with initial balance.'
      });
    }

    // Sort transactions by creation date descending (newest first)
    const sortedTransactions = wallet.transactions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    res.status(200).json({
      balance: wallet.balance,
      transactions: sortedTransactions,
    });

  } catch (error) {
    console.error('Error fetching wallet details:', error);
    res.status(500).json({ message: 'Failed to fetch wallet details.', error: error.message });
  }
});

// POST /api/user/feedback - Submit feedback with optional media
router.post(
  '/feedback',
  async (req, res) => {
    try {
      const { subject, message, orderId, type, attachments } = req.body; // attachments now expected in JSON body
      const userId = req.user._id;

      // Basic validation
      if (!subject || !message || !type) {
        return res.status(400).json({ message: 'Subject, message, and type are required.' });
      }

      // Validate attachments if necessary (e.g., check if they are valid URLs/paths)
      // You might want to check if the paths exist on your server/cloud storage, etc.

      const newFeedback = new Feedback({
        userId,
        orderId: orderId || null,
        subject,
        message,
        type,
        attachments: attachments || [], // Expect attachments as an array of paths/URLs
      });

      await newFeedback.save();

      res.status(201).json({ message: 'Feedback submitted successfully!', feedback: newFeedback });
    } catch (error) {
      console.error('Error submitting feedback:', error);
      res.status(500).json({ message: 'Server error while submitting feedback.' });
    }
  }
);

// You can add other user-related endpoints here, e.g., GET user details, update user settings, etc.
// router.get('/me', authenticateToken, async (req, res) => { ... }); // Already in auth.js /profile

// Export the router
module.exports = router;
