const express = require("express");
const mongoose = require('mongoose');
const router = express.Router();

const Match = require("../models/Match");
const Resource = require("../models/Resource");
const User = require('../models/User'); // Required for populating user addresses
const Coupon = require('../models/Coupon');
const isOutsidePeakPeriod = require('../utils/isOutsidePeakPeriod');
const { requestMatchRefund } = require('../controllers/refundController');

// Define the 1-day acceptance window duration (in milliseconds)
const ACCEPTANCE_WINDOW_DURATION_MS = 24 * 60 * 60 * 1000; // 1 day

// --- Helper function to apply penalty (Implement this logic) ---
async function applyTimeoutPenalty(userId) {
    console.log(`Applying timeout penalty to user ${userId}`);
    // Find the user and deduct 5 credit
    try {
        const user = await User.findById(userId);
        if (user) {
            user.credit = Math.max(0, user.credit - 5); // Deduct 5 credit, ensuring not negative
            await user.save();
            console.log(`Deducted 5 credit from user ${userId}. New credit: ${user.credit}`);
        } else {
            console.log(`User ${userId} not found for penalty application.`);
        }
    } catch (error) {
        console.error(`Error applying penalty to user ${userId}:`, error);
        // Decide how to handle errors in applying penalties
    }
    // You might want to log this penalty event somewhere
}

// --- Helper function to send match notifications ---
async function sendMatchNotification(match, messageKey, recipientUserId) {
  if (!notificationQueue) {
    console.error("notificationQueue not initialized. Cannot send notification.");
    return;
  }
  try {
    await notificationQueue.add('sendNotification', {
      userId: recipientUserId,
      messageKey: messageKey,
      data: {
        matchId: match._id.toString(),
        requesterId: match.requester.toString(),
        ownerId: match.owner.toString(),
        status: match.status,
        // Add other relevant match details for the notification worker
      }
    }, {
      jobId: `notify-${messageKey}-match-${match._id.toString()}-user-${recipientUserId.toString()}-${Date.now()}`,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      }
    });
    console.log(`Notification enqueued for user ${recipientUserId} with key ${messageKey} for match ${match._id}`);
  } catch (error) {
    console.error(`Failed to enqueue notification for user ${recipientUserId} with key ${messageKey} for match ${match._id}:`, error);
  }
}

router.get("/", async (req, res) => {
  try {
    const currentUserId = req.user?.userId;
    const userIdQueryParam = req.query.userId;
    const status = req.query.status;

    let filter = {};

    if (currentUserId) {
      filter.$or = [{ requester: currentUserId }, { owner: currentUserId }];
    } else if (userIdQueryParam) {
      console.warn("Fetching matches filtered by userId query param without authentication.");
      filter.$or = [{ requester: userIdQueryParam }, { owner: userIdQueryParam }];
    }

    if (status && status !== "all") {
      filter.status = status;
    }

    const matches = await Match.find(filter).populate(
      "requester owner resource1 resource2"
    ).lean();

    const matchesWithType = matches.map(match => ({
      ...match,
      type: "match",
    }));

    res.json(matchesWithType);
  } catch (err) {
    console.error("Error in /api/match:", err);
    res.status(500).json({ message: err.message });
  }
});

// --- Endpoint to Get a specific Match by ID ---
// Apply authentication middleware to protect this endpoint
router.get('/:id', async (req, res) => {
  try {
    const matchId = req.params.id;

    // Find the match by ID and populate all necessary referenced documents
    const match = await Match.findById(matchId)
      // Populate user details for requester and owner
      .populate('requester', 'username name') // Select only 'username' and 'name' from User model
      .populate('owner', 'username name')     // Select only 'username' and 'name' from User model
      // Populate resource details for resource1 and resource2
      // Include 'name', 'description', 'specifications', 'media', 'price', 'type'
      // Adjust these 'select' fields based on what your frontend actually displays for these resources
      .populate('resource1', 'name description specifications media price type')
      .populate('resource2', 'name description specifications media price type')
      // Populate the serviceRequest, which itself is a 'Resource'
      .populate({
        path: 'serviceRequest', // Path to the ServiceRequest document (a Resource type)
        // Now, populate the assignedErrandID within the serviceRequest if it exists
        populate: {
          path: 'assignedErrandID', // Path to the Errand document linked to the ServiceRequest
          model: 'Errand',          // Explicitly define the model for 'assignedErrandID'
          // Select fields from the Errand document: 'status' is crucial for the button logic
          // Also including 'errandRunner', 'pickupLocation', 'dropoffLocation', 'deliveryFee' for display purposes
          select: 'status errandRunner pickupLocation dropoffLocation deliveryFee',
          // Finally, populate the errandRunner (which is a 'User') from the Errand document
          populate: {
            path: 'errandRunner',   // Path to the ErrandRunner (User) within the Errand document
            model: 'User',          // Explicitly define the model for 'errandRunner'
            select: 'username name' // Select 'username' and 'name' from the ErrandRunner (User)
          }
        }
      });

    // Check if the match was found
    if (!match) {
      return res.status(404).json({ message: 'Match not found.' });
    }

    // Optional: Add an authorization check to ensure only the requester or owner can view this match's details
    // Uncomment and adapt if you need this security layer.
    // if (match.requester._id.toString() !== req.user._id.toString() &&
    //     match.owner._id.toString() !== req.user._id.toString()) {
    //   return res.status(403).json({ message: 'Unauthorized access to match details.' });
    // }

    // Send the populated match data back to the client
    res.status(200).json(match);

  } catch (error) {
    console.error(`Error fetching match with ID ${req.params.id}:`, error);
    res.status(500).json({ message: 'Server error while fetching match details.', error: error.message });
  }
});


// --- Endpoint to Accept Suggested Price for a Pending Match ---
router.put('/:id/accept',
  // authenticateToken, // Applied globally as per user, no need to add here
  async (req, res) => {
    const matchId = req.params.id;
    const userId = req.user ? req.user._id : null;

    if (!mongoose.Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({ message: 'Invalid Match ID format.' });
    }
    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated.' });
    }

    const session = await mongoose.startSession();
    session.startTransaction(); // Start the transaction

    try {
      const match = await Match.findById(matchId).session(session); // Pass session to findById

      if (!match) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: 'Match not found.' });
      }

      const isRequester = match.requester.equals(userId);
      const isOwner = match.owner.equals(userId);

      if (!isRequester && !isOwner) {
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({ message: 'You are not authorized to perform this action on this match.' });
      }

      if (match.status !== 'pending') {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: `Cannot accept suggested price. Match status must be 'pending'. Current status: ${match.status}` });
      }

      if (match.requesterAcceptedSuggestedPrice === true && match.ownerAcceptedSuggestedPrice === true) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: 'Suggested price has already been accepted by both parties.' });
      }

      let isFirstAcceptance = (match.requesterAcceptedSuggestedPrice === false && isRequester) ||
        (match.ownerAcceptedSuggestedPrice === false && isOwner);

      let isSecondAcceptance = (match.requesterAcceptedSuggestedPrice === true && isOwner) ||
        (match.ownerAcceptedSuggestedPrice === true && isRequester);


      if (isFirstAcceptance) {
        console.log(`Processing first acceptance of suggested price for match ${matchId} by user ${userId}`);

        if (isRequester) {
          match.requesterAcceptedSuggestedPrice = true;
        } else { // isOwner
          match.ownerAcceptedSuggestedPrice = true;
        }

        match.firstAcceptanceTime = new Date();

        await match.save({ session }); // Pass session to save

        const otherUserId = isRequester ? match.owner : match.requester;
        await sendMatchNotification(match, 'suggested_accepted_by_counterparty', otherUserId);

        await session.commitTransaction(); // Commit transaction on success
        session.endSession();

        res.status(200).json({
          message: 'Suggested price accepted. Waiting for other party.',
          match: match.toObject()
        });

      } else if (isSecondAcceptance) {
        console.log(`Processing second acceptance of suggested price for match ${matchId} by user ${userId}`);

        const firstAcceptanceTime = match.firstAcceptanceTime;
        if (!firstAcceptanceTime) {
          console.error(`Error: firstAcceptanceTime is null for a perceived second acceptance on match ${matchId}`);
          await session.abortTransaction();
          session.endSession();
          return res.status(500).json({ message: 'Error processing acceptance state: first acceptance time missing.' });
        }

        const windowEndTime = new Date(firstAcceptanceTime.getTime() + ACCEPTANCE_WINDOW_DURATION_MS);

        if (new Date() <= windowEndTime) {
          // --- Acceptance is WITHIN the 1-day window ---
          console.log(`Second acceptance within window for match ${matchId}. Finalizing match.`);
          if (isRequester) {
            match.requesterAcceptedSuggestedPrice = true;
          } else { // isOwner
            match.ownerAcceptedSuggestedPrice = true;
          }

          match.status = 'accepted';
          match.resource1Payment = match.suggestedPriceRequester;
          match.resource2Receipt = match.suggestedPriceOwner;
          match.agreedPrice = match.resource1Payment; // As per user's request: agreedPrice is same as resource1Payment
          match.timeoutPenaltyAppliedTo = null;

          await match.save({ session }); // Pass session to save

          await sendMatchNotification(match, 'match_accepted', match.requester);
          await sendMatchNotification(match, 'match_accepted', match.owner);

          await session.commitTransaction(); // Commit transaction on success
          session.endSession();

          res.status(200).json({
            message: 'Match accepted!',
            match: match.toObject()
          });

        } else {
          // --- Acceptance is OUTSIDE the 1-day window (Timeout) ---
          console.log(`Second acceptance outside window for match ${matchId}. Match timed out.`);

          match.status = 'cancelled';
          match.cancellationReason = 'negotiation_timeout'; // Add a specific reason
          const timedOutUserId = userId;
          match.timeoutPenaltyAppliedTo = timedOutUserId;

          await match.save({ session }); // Save the match state with session

          await applyTimeoutPenalty(timedOutUserId); // This function should handle its own saving or be part of transaction

          await sendMatchNotification(match, 'match_timed_out', match.requester);
          await sendMatchNotification(match, 'match_timed_out', match.owner);

          await session.commitTransaction(); // Commit the cancellation/timeout
          session.endSession();

          res.status(400).json({
            message: 'Match negotiation window expired. Match cancelled due to timeout.',
            match: match.toObject()
          });
        }

      } else {
        console.error(`Error: Unexpected acceptance state for match ${matchId}. Flags: R: ${match.requesterAcceptedSuggestedPrice}, O: ${match.ownerAcceptedSuggestedPrice}`);
        await session.abortTransaction();
        session.endSession();
        return res.status(500).json({ message: 'Error processing acceptance state.' });
      }

    } catch (error) {
      await session.abortTransaction(); // Abort transaction on error
      session.endSession();

      console.error(`Error processing accept suggested price for match ${matchId}:`, error);
      if (error.name === 'CastError') {
        return res.status(400).json({ message: 'Invalid Match ID format.' });
      }
      if (error.name === 'ValidationError') {
        return res.status(400).json({ message: `Validation Error: ${error.message}` });
      }
      res.status(500).json({ message: 'Failed to process acceptance.' });
    }
  }
);


// --- Endpoint to Reject a Pending Match ---
// Endpoint: PUT /api/match/:id/reject
// Changes status from 'pending' to 'cancelled'
router.put('/:id/reject',
    // authenticateToken, // Apply authentication middleware if needed
    async (req, res) => {
        const matchId = req.params.id;
         // Assuming user ID is available in req.user._id after authentication
        const userId = req.user ? req.user._id : null; // Replace with your actual way to get user ID

        if (!mongoose.Types.ObjectId.isValid(matchId)) {
            return res.status(400).json({ message: 'Invalid Match ID format.' });
        }
         if (!userId) {
             return res.status(401).json({ message: 'User not authenticated.' });
        }

        try {
            const match = await Match.findById(matchId);

            if (!match) {
                return res.status(404).json({ message: 'Match not found.' });
            }

            // --- Authorization Check ---
            // Ensure the user is either the requester or the owner of this match
            const isRequester = match.requester.equals(userId);
            const isOwner = match.owner.equals(userId);

            if (!isRequester && !isOwner) {
                return res.status(403).json({ message: 'You are not authorized to perform this action on this match.' });
            }

            // --- Status Check ---
            // Rejection is only valid if the match status is 'pending'
            if (match.status !== 'pending') {
                return res.status(400).json({ message: `Cannot reject match. Match status must be 'pending'. Current status: ${match.status}` });
            }

            // --- Update Status to Cancelled ---
            match.status = 'cancelled';
            match.rejectedBy = userId; // Record who rejected it (optional)

            // If the match was already in the 1-day window (firstAcceptanceTime is not null),
            // should the other user get a notification that it was rejected before they accepted? Yes.
            // No penalty for rejection itself, only for timeout.

            // Save the updated match state
            await match.save();

            // Notify both users that the match was rejected
            // await sendMatchNotification(match, 'match_rejected', match.requester); // Implement notification
            // await sendMatchNotification(match, 'match_rejected', match.owner);     // Implement notification


            res.status(200).json({
                message: 'Match rejected.',
                match: match.toObject()
            });

        } catch (error) {
            console.error(`Error rejecting match ${matchId}:`, error);
            if (error.name === 'CastError') {
                return res.status(400).json({ message: 'Invalid Match ID format.' });
            }
             if (error.name === 'ValidationError') {
                 return res.status(400).json({ message: `Validation Error: ${error.message}` });
             }
            res.status(500).json({ message: 'Failed to reject match.' });
        }
    }
);


// --- Endpoint to Cancel an Accepted (or other statuses) Match ---
// Endpoint: PUT /api/match/:id/cancel
// Changes status to 'canceled', includes reason and updates resource status
router.put('/:id/cancel',
    // authenticateToken, // Apply middleware
    async (req, res) => {
    const matchId = req.params.id;
    const userId = req.user._id; // Get authenticated user ID
    const { cancellationReason } = req.body; // Expect reason in body

     if (!mongoose.Types.ObjectId.isValid(matchId)) {
         return res.status(400).json({ message: 'Invalid Match ID format.' });
     }

    try {
        const match = await Match.findById(matchId);

        if (!match) {
            return res.status(404).json({ message: 'Match not found.' });
        }

        // --- Authorization Check ---
        // Assuming either requester or owner can cancel a match if status allows.
        const isRequester = match.requester.equals(userId);
        const isOwner = match.owner.equals(userId);

        if (!isRequester && !isOwner) {
            return res.status(403).json({ message: 'You are not authorized to cancel this match.' });
        }

        // --- Status Transition Check ---
        // Allow cancellation from statuses like 'accepted', 'paid', 'erranding'.
        // Do NOT allow cancellation if already 'completed', 'canceled', 'declined'.
         const allowedStatusesToCancel = ['accepted', 'paid', 'erranding']; // Removed 'pending' as pending is declined

        if (!allowedStatusesToCancel.includes(match.status)) {
            return res.status(400).json({ message: `Match cannot be canceled in status: ${match.status}` });
        }


        // --- Update Status ---
        match.status = 'canceled';
        // Save cancellation reason from body
        if (cancellationReason) {
             match.cancellationReason = cancellationReason;
        } else {
            // If reason is required by schema, check here
             // return res.status(400).json({ message: 'Cancellation reason is required.' });
        }


        // Save the updated match
        await match.save();

        // --- Update Resource Statuses (Integrating logic from your function) ---
        // Assuming cancelling a match makes the linked resources available again
        if (match.resource1) {
            await Resource.findByIdAndUpdate(match.resource1, { status: 'matching' });
        }
        if (match.resource2) {
            await Resource.findByIdAndUpdate(match.resource2, { status: 'matching' });
        }


        res.status(200).json({
            message: 'Match canceled and resources reverted', // Using your message
            match: match.toObject()
        });

    } catch (err) {
        console.error(`Error canceling match ${matchId}:`, err);
         if (err.name === 'CastError') {
             return res.status(400).json({ message: 'Invalid ID format.' });
         }
         if (err.name === 'ValidationError') {
              return res.status(400).json({ message: `Validation Error: ${err.message}` });
         }
        res.status(500).json({ message: 'Failed to cancel match.' });
    }
});


// Endpoint: PUT /api/match/:id/confirm-order
router.put('/:id/confirm-order',
  // Apply your authentication middleware here (e.g., authenticateToken)
  async (req, res) => {
    const matchId = req.params.id;
    const userId = req.user ? req.user._id : new mongoose.Types.ObjectId('YOUR_DUMMY_REQUESTER_ID');

    const userspec = req.body.specifications;

    if (!userspec) {
      return res.status(400).json({ message: 'Specifications are required in the request body.' });
    }

    const { from_address: from, to_address: to, delivery_time: deliveryTime, door_delivery: doorDelivery, door_delivery_units: doorUnits } = userspec;

    if (!from || !to || !from.district || !to.district) {
      return res.status(400).json({ message: 'Missing required address details in specifications (from_address, to_address, district).' });
    }
    if (doorDelivery && (!doorUnits || typeof doorUnits !== 'number' || doorUnits <= 0)) {
      return res.status(400).json({ message: 'Valid door_delivery_units is required and must be a positive number when door_delivery is true.' });
    }

    if (!mongoose.Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({ message: 'Invalid Match ID format.' });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Fetch Match and populate resource1
      const match = await Match.findById(matchId).populate('resource1').session(session);

      if (!match) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: 'Match not found.' });
      }

      if (!match.requester.equals(userId)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({ message: 'Only the requester is authorized to confirm this order.' });
      }

      if (match.status !== 'accepted') {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: `Match status must be 'accepted' to confirm order. Current status: ${match.status}` });
      }

      if (match.serviceRequest) {
        await session.abortTransaction();
        session.endSession();
        return res.status(409).json({ message: 'A Service Request (Resource) has already been created for this Match. Cannot create a duplicate.' });
      }

      let calculatedPrice = from.district === to.district ? 1 : 2;

      if (deliveryTime && isOutsidePeakPeriod(deliveryTime)) {
        calculatedPrice *= 2;
      }

      if (doorDelivery) {
        calculatedPrice += 5;
      }

      // --- Extract addresses for the service request ---
      let serviceRequestSpecifications = userspec; // Start with the user-provided specs

      // If resource1 is a rent/lease type, use its location_address
      if (['rent', 'lease'].includes(match.resource1.type)) {
        serviceRequestSpecifications.itemLocationAddress = match.resource1.specifications?.location_address;
      }

      // You might need to fetch resource2 as well if it contains relevant address info
      // const resource2 = await Resource.findById(match.resource2).session(session);
      // if (resource2 && resource2.type === 'buy') {
      //   serviceRequestSpecifications.deliveryAddress = resource2.specifications?.delivery_address;
      // }

      const newServiceResource = new Resource({
        name: `${match.resource1.name} 的跑腿服务`,
        description: '',
        category: '',
        specifications: serviceRequestSpecifications, // Use the potentially updated specifications
        price: calculatedPrice,
        userId: match.requester,
        type: 'service-request',
        status: 'matching',
        originatingMatchId: match._id,
        assignedErrandId: null,
        assignedMatchId: null,
      });
      await newServiceResource.save({ session });

      match.serviceRequest = newServiceResource._id;
      match.status = 'paid';
      await match.save({ session });

      await session.commitTransaction();
      session.endSession();

      console.log(`[ACTION]: Order confirmed for Match ${matchId}. Resource ${newServiceResource._id} (type: service-request) created and Match status updated to 'paid'.`);

      res.status(200).json({
        message: 'Order confirmed. Service Request Resource created and Match status updated to "paid".',
        match: match.toObject(),
        serviceResource: newServiceResource.toObject(),
      });

    } catch (err) {
      await session.abortTransaction();
      session.endSession();

      console.error(`Error confirming order for match ${matchId}:`, err);
      if (err.name === 'CastError') {
        return res.status(400).json({ message: 'Invalid ID format.' });
      }
      res.status(500).json({ message: 'Failed to confirm order.' });
    }
  }
);

// --- Endpoint to Apply a Coupon to a Match ---
// Endpoint: PUT /api/match/:id/coupon
// Applies a coupon code, calculates discount, updates match finalAmount
router.put('/:id/coupon',
  // authenticateToken, // Apply your authentication middleware here
  async (req, res) => {
    const matchId = req.params.id;
    const userId = req.user._id; // Get authenticated user ID (from auth middleware)
    const { couponCode } = req.body; // Expect coupon code in the request body

    // Validate if matchId is a valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(matchId)) {
      return res.status(400).json({ message: 'Invalid Match ID format.' });
    }

    if (!couponCode || typeof couponCode !== 'string' || couponCode.trim() === '') {
      return res.status(400).json({ message: 'Coupon code is required.' });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // 1. Find the Match
      const match = await Match.findById(matchId).session(session);

      if (!match) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: 'Match not found.' });
      }

      // --- Authorization Check ---
      // Only the user who needs to pay for this match (the requester) should apply a coupon.
      if (!match.requester.equals(userId)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({ message: 'You are not authorized to apply a coupon to this match.' });
      }

      // --- Status Check ---
      // Only allow applying coupon if the match is in a payable status (e.g., 'accepted')
      const payableStatuses = ['accepted'];
      if (!payableStatuses.includes(match.status)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: `Cannot apply coupon in status: ${match.status}. Match must be in status ${payableStatuses.join(' or ')}.` });
      }

      // Check if a coupon has already been applied
      // Now checking the couponApplication sub-document
      if (match.couponApplication && match.couponApplication.couponId) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: 'A coupon has already been applied to this match.' });
      }

      // 2. Find the Coupon
      const coupon = await Coupon.findOne({ code: couponCode.trim(), user: userId }).session(session); // Ensure user owns the coupon

      if (!coupon) {
        await session.abortTransaction();
        session.endSession();
        // Return a generic "not found or not applicable" message for security reasons
        return res.status(404).json({ message: 'Coupon not found or not applicable.' });
      }

      // 3. Validate the Coupon
      if (!coupon.isActive || (coupon.expiryDate && coupon.expiryDate < new Date())) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: 'Coupon is expired or inactive.' });
      }
      if (coupon.usedAt) { // For single-use coupons or coupons with usage limits
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: 'Coupon has already been used.' });
      }
      // Add checks for coupon usage limit per user/overall limit if applicable.
      // e.g., const userCouponUsageCount = await CouponUsage.countDocuments({ couponId: coupon._id, userId });
      // if (userCouponUsageCount >= coupon.perUserLimit) { ... }

      // Check minimum order amount against the match's totalAmount
      if (coupon.minimumOrderAmount && match.totalAmount < coupon.minimumOrderAmount) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: `Minimum order amount of ¥${coupon.minimumOrderAmount.toFixed(2)} required.` });
      }

      // 4. Calculate the Discount
      let discountAmount = 0;
      if (coupon.discountType === 'percentage') {
        discountAmount = match.totalAmount * (coupon.discountValue / 100);
        if (coupon.maxDiscount && discountAmount > coupon.maxDiscount) {
          discountAmount = coupon.maxDiscount;
        }
      } else if (coupon.discountType === 'fixed_amount') { // Renamed from 'fixed' to 'fixed_amount' as per Coupon schema
        discountAmount = coupon.discountValue;
        if (discountAmount > match.totalAmount) {
          discountAmount = match.totalAmount;
        }
      } else {
        await session.abortTransaction();
        session.endSession();
        console.error(`Unknown discount type for coupon ${coupon._id}: ${coupon.discountType}`);
        return res.status(500).json({ message: 'Invalid coupon configuration.' });
      }
      discountAmount = Math.max(0, discountAmount);

      // 5. Update the Match with coupon application details
      match.couponApplication = {
        couponId: coupon._id,
        couponCode: coupon.code,
        discountAmount: discountAmount,
        appliedAt: new Date() // Set the application timestamp
      };
      match.finalAmount = match.totalAmount - discountAmount; // Recalculate final amount

      await match.save({ session });

      // 6. Update the Coupon to mark it as used (for single-use or limited-use coupons)
      coupon.usedAt = new Date(); // Mark coupon as used (if single-use)
      coupon.usedOnMatch = match._id; // Link coupon to the match it was used on (if applicable)
      // If `usageLimit` or `perUserLimit` are greater than 1, you'd manage usage counts separately
      // e.g., by creating a CouponUsage document or incrementing a counter.
      await coupon.save({ session });

      await session.commitTransaction();
      session.endSession();

      // 7. Return the Updated Match (with populated coupon details if needed by frontend)
      const updatedMatch = await Match.findById(match._id)
        .populate('couponApplication.couponId') // Populate the actual coupon document within the sub-document
        .populate('requester')
        .populate('owner')
        .populate('originalRequest')
        .lean(); // Use .lean() for faster reads if you don't need Mongoose document methods

      res.status(200).json({
        message: 'Coupon applied successfully',
        match: updatedMatch // Return the updated match object
      });

    } catch (err) {
      await session.abortTransaction();
      session.endSession();

      console.error(`Error applying coupon ${couponCode} to match ${matchId}:`, err);
      if (err.name === 'CastError') {
        return res.status(400).json({ message: 'Invalid ID format.' });
      }
      if (err.name === 'ValidationError') { // Handle Mongoose validation errors
        return res.status(400).json({ message: `Validation Error: ${err.message}` });
      }
      res.status(500).json({ message: 'Failed to apply coupon.' });
    }
  }
);


// PUT /api/match/:id/complete
// Endpoint for the Match Requester to confirm receipt and complete the match.
// This will trigger an internal transfer of funds to the Match Owner's wallet.
router.put('/:id/complete', async (req, res) => {
  const session = await mongoose.startSession(); // Start a Mongoose session for transaction
  session.startTransaction();

  try {
    const matchId = req.params.id;
    const currentUserId = req.user._id;

    // 1. Find the Match and populate necessary fields
    const match = await Match.findById(matchId)
      .populate('requester', '_id')
      .populate('owner', '_id') // Populate owner to credit their wallet
      .populate({
        path: 'serviceRequest',
        populate: {
          path: 'assignedErrandID',
          model: 'Errand',
          select: 'status'
        }
      }).session(session); // Apply session to the query

    // 2. Basic Validation: Check if the match exists
    if (!match) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Match not found.' });
    }

    // 3. Authorization: Only the requester of the match can complete it
    if (match.requester._id.toString() !== currentUserId.toString()) {
      await session.abortTransaction();
      return res.status(403).json({ message: 'Unauthorized: Only the match requester can complete this order.' });
    }

    // 4. Status Validation: Check the current status of the match
    if (match.status === 'completed') {
      await session.abortTransaction();
      return res.status(400).json({ message: 'This match is already completed.' });
    }
    if (match.status === 'cancelled') {
      await session.abortTransaction();
      return res.status(400).json({ message: 'This match has been cancelled and cannot be completed.' });
    }
    if (match.status !== 'paid' && match.status !== 'erranding') {
      await session.abortTransaction();
      return res.status(400).json({ message: `Match cannot be completed from status: ${match.status}. It should be 'paid' or 'erranding'.` });
    }

    // 5. Crucial Validation: Check the status of the associated Errand
    if (!match.serviceRequest || !match.serviceRequest.assignedErrandID) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Associated errand information is missing. Cannot complete the match.' });
    }
    if (match.serviceRequest.assignedErrandID.status !== 'completed') {
      await session.abortTransaction();
      return res.status(400).json({ message: `The associated errand status is '${match.serviceRequest.assignedErrandID.status}'. It must be 'completed' before the match can be finalized.` });
    }

    // 6. Internal Payout (Crediting Owner's Wallet)
    // Ensure finalAmount is present and valid for payout
    if (typeof match.finalAmount !== 'number' || match.finalAmount <= 0) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Match final amount is invalid for payout.' });
    }
    if (!match.owner || !match.owner._id) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Match owner information missing for payout.' });
    }

    // Find owner's wallet using 'userId' as per the new schema
    const ownerWallet = await Wallet.findOne({ userId: match.owner._id }).session(session); // <--- UPDATED: use userId
    if (!ownerWallet) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Owner wallet not found. Cannot complete match.' });
    }

    // Credit the owner's wallet balance
    ownerWallet.balance += match.finalAmount;

    // Add a transaction record to the owner's wallet using the new schema fields
    ownerWallet.transactions.push({
      type: 'credit',
      amount: match.finalAmount,
      description: `Earnings from Match Completion (ID: ${match._id})`,
      referenceId: match._id,       // <--- UPDATED: use referenceId
      referenceModel: 'Match',      // <--- UPDATED: use referenceModel
      status: 'completed',          // <--- NEW FIELD: set to 'completed' for immediate credit
      transactionFee: 0,            // <--- NEW FIELD: Assuming no fee for this internal credit
      processedBy: 'System'         // <--- NEW FIELD: indicates automated processing
    });
    await ownerWallet.save({ session }); // Save the updated owner's wallet

    const ownerUser = await User.findById(match.owner._id).session(session); // Find the owner's User document
    if (!ownerUser) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Owner user profile not found. Cannot award points/credits.' });
    }

    // Award points: For example, 1 point for every RM 1.00 (or its currency equivalent)
    const pointsEarned = Math.floor(match.finalAmount); // Round down to nearest whole point
    if (pointsEarned > 0) {
      ownerUser.points += pointsEarned;
      console.log(`User ${ownerUser._id} earned ${pointsEarned} points from Match ${match._id}.`);
    }

    let creditsAwarded = 0; // Initialize to track if a credit was actually awarded
    if (ownerUser.credits < 100) { // <--- NEW: Check for max cap
      ownerUser.credits += 1;
      creditsAwarded = 1;
      console.log(`User ${ownerUser._id} earned 1 credit from Match ${match._id}. New credits: ${ownerUser.credits}.`);
    } else {
      console.log(`User ${ownerUser._id} has maxed out credits (100) from Match ${match._id}. No credit awarded.`);
    }

    await ownerUser.save({ session }); // Save the updated owner's User document

    // 7. Update Match Status
    match.status = 'completed';
    match.updatedAt = Date.now();

    // 8. Save the updated Match document
    await match.save({ session }); // Apply session to the save operation

    // 9. Commit Transaction
    await session.commitTransaction();

    // 10. Success Response
    res.status(200).json({
      message: 'Match successfully completed and owner wallet credited.',
      match: match
    });

  } catch (error) {
    await session.abortTransaction(); // Rollback any changes on error
    console.error(`Error completing match ${req.params.id}:`, error);
    if (error.kind === 'ObjectId') {
      return res.status(400).json({ message: 'Invalid Match ID format.' });
    }
    res.status(500).json({ message: 'Server error during match completion.', error: error.message });
  } finally {
    session.endSession(); // Always end the session
  }
});

// Route to initiate a refund request for a Match
router.put('/:id/refund', requestMatchRefund);

module.exports = router;
