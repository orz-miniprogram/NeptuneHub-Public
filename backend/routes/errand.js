// backend/routes/errand.js

const express = require('express');
const router = express.Router();
const Errand = require('../models/Errand');
const Resource = require('../models/Resource');
const Coupon = require('../models/Coupon');
const RunnerProfile = require('../models/RunnerProfile');
const User = require('../models/User'); // Need for notifications/potentially wallet lookup
const Wallet = require('../models/Wallet');
const mongoose = require('mongoose');
const axios = require('axios'); // For sending notifications

const upload = require('../utils/multerConfig'); // Import Multer upload instance
const { requestErrandRefund } = require('../controllers/refundController');

// Assuming authentication middleware populates req.user
// Define NODEJS_NOTIFICATION_URL - assuming it's accessible via config or env
const NODEJS_NOTIFICATION_URL = process.env.NODEJS_NOTIFICATION_URL || 'http://localhost:5000/api/notifications/send';
const MIN_MATCH_SCORE = 5; // This should be consistent with Python worker

// Base Route - Check API is working
router.get('/test', (req, res) => {
  res.json({ message: "Errand API is working!" });
});

// --- POST /api/errand/:id/claim - Runner claims a specific service-request ---
// :id refers to the _id of the service-request Resource
router.post('/:id/claim', async (req, res) => {
  console.log(`Backend - Received POST /api/errand/${req.params.id}/claim request.`);
  const serviceRequestId = req.params.id;
  const runnerId = req.user._id; // Authenticated user is the runner claiming the errand

  // 1. Basic Validation and Authentication Check
  if (!runnerId) {
    return res.status(401).json({ message: 'Authentication required to claim an errand.' });
  }
  if (!req.user.isRunner) { // Check if the authenticated user is actually a runner
    return res.status(403).json({ message: 'Only registered runners can claim errands.' });
  }
  if (!mongoose.Types.ObjectId.isValid(serviceRequestId)) {
    return res.status(400).json({ message: 'Invalid Service Request ID format.' });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 2. Fetch the Service Request Resource
    const serviceRequestResource = await Resource.findById(serviceRequestId).session(session);

    if (!serviceRequestResource || serviceRequestResource.type !== 'service-request') {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Service request resource not found or is not a valid errand request.' });
    }

    // 3. Check if the Service Request is already matched/claimed/canceled
    if (serviceRequestResource.status === 'matched' || serviceRequestResource.assignedErrandId) {
      await session.abortTransaction();
      return res.status(409).json({ message: 'This errand request has already been claimed or matched.' });
    }
    if (serviceRequestResource.status === 'cancelled') { // Consistent spelling with Python worker
      await session.abortTransaction();
      return res.status(400).json({ message: 'This errand request has been cancelled.' });
    }
    if (serviceRequestResource.status === 'expired') { // Add check for 'expired' status if applicable
      await session.abortTransaction();
      return res.status(400).json({ message: 'This errand request has expired.' });
    }

    // 4. Fetch the Runner Profile and validate the match
    const runnerProfile = await RunnerProfile.findOne({ userId: runnerId }).session(session);

    if (!runnerProfile) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Runner profile not found.' });
    }

    const potentialErrand = runnerProfile.potentialErrandRequests.find(
      p => p.requestId.toString() === serviceRequestId && p.score >= MIN_MATCH_SCORE
    );

    if (!potentialErrand) {
      await session.abortTransaction();
      return res.status(403).json({ message: 'You are not eligible to claim this errand, or the match score is too low.' });
    }

    // Retrieve the specific service-offer resource associated with this potential match
    // This requires `populate_potential_matches_job` to store `offerId`
    const runnerOfferResource = await Resource.findById(potentialErrand.offerId).session(session);

    if (!runnerOfferResource || runnerOfferResource.status !== 'active') { // Check status of the specific offer
      await session.abortTransaction();
      return res.status(400).json({ message: 'The specific service offer used for this match is no longer active or found.' });
    }


    // 5. Update the status of the Service Request Resource
    serviceRequestResource.status = 'matched';
    serviceRequestResource.assignedRunnerId = runnerId; // This line is slightly redundant as the Python worker sets assignedErrandId, but harmless here for quick update
    // The assignedErrandId will be set after the Errand document is created
    await serviceRequestResource.save({ session });

    // 6. Update the status/usage of the accepted Service Offer Resource
    // If a general offer can be used multiple times, update a usage count or simply 'matched' status
    // For now, let's assume a service-offer can be claimed once or its status needs updating.
    // It's more likely that `service-offer` resources are *templates* of availability.
    // If a service-offer is specifically tied to one errand fulfillment at a time:
    runnerOfferResource.status = 'unavailable'; // Or 'claimed' or 'matched' for this specific offer.
    await runnerOfferResource.save({ session });
    // If it's a general availability offer, you might not change its status,
    // but rather add a 'claimedAt' timestamp or increment a 'claimedCount' for this specific resource.
    // For simplicity, we'll mark it as 'unavailable' for now.

    // 7. Create the Errand Document
    const errand = new Errand({
      errandRequestResourceId: serviceRequestId,
      acceptedOfferResourceId: runnerOfferResource._id, // Store the specific offer that was used
      errandRunner: runnerId,
      currentStatus: 'assigned', // Initial status after being claimed/assigned
      // Copy relevant specifications from the service request resource
      pickupLocation: serviceRequestResource.specifications.from_address,
      dropoffLocation: serviceRequestResource.specifications.to_address,
      isDeliveryToDoor: serviceRequestResource.specifications.door_delivery || false,
      deliveryFee: serviceRequestResource.price || 0, // Use the 'price' field from the Resource itself, not specs.delivery_fee
      doorDeliveryUnits: serviceRequestResource.specifications.door_delivery_units,
      expectedStartTime: serviceRequestResource.specifications.expectedStartTime,
      expectedEndTime: serviceRequestResource.specifications.expectedEndTime,
      expectedTimeframeString: serviceRequestResource.specifications.expectedTimeframeString,
      createdAt: new Date(),
      updatedAt: new Date(),
      // Add other fields as necessary
    });
    await errand.save({ session });

    // 8. Update the Service Request Resource with the new Errand ID
    serviceRequestResource.assignedErrandId = errand._id;
    await serviceRequestResource.save({ session });

    // 9. Remove the claimed request from the runner's potentialErrandRequests
    await RunnerProfile.updateOne(
      { _id: runnerProfile._id },
      { $pull: { potentialErrandRequests: { requestId: new mongoose.Types.ObjectId(serviceRequestId) } } },
      { session }
    );


    await session.commitTransaction();
    // --- TRANSACTION END ---

    // 10. Notify relevant parties (outside transaction for resilience)
    console.log(`Backend - Runner ${runnerId} successfully claimed errand request ${serviceRequestId}. New Errand ID: ${errand._id}`);
    res.status(200).json({
      message: 'Errand claimed and assigned successfully.',
      errandId: errand._id,
      runnerId: runnerId
    });

    // Send Notifications (using axios for HTTP POST to Node.js notification service)
    const requesterId = serviceRequestResource.userId.toString(); // Original user who made the request
    const runnerUserId = runnerId.toString(); // User who claimed it

    // Notify the errand requester that their request has been claimed/assigned a runner.
    try {
      const requesterNotificationPayload = {
        userId: requesterId,
        message: `Your errand request "${serviceRequestResource.name}" has been claimed by a runner!`,
        data: {
          errandId: errand._id.toString(),
          resourceId: serviceRequestId,
          type: 'errand_claimed',
          runnerId: runnerUserId,
          errandName: serviceRequestResource.name
        }
      };
      await axios.post(NODEJS_NOTIFICATION_URL, requesterNotificationPayload, { timeout: 5000 });
      console.log(`Backend - Notification sent to requester ${requesterId} for claimed errand.`);
    } catch (notifError) {
      console.error(`Backend - Failed to send notification to requester ${requesterId}:`, notifError.message);
    }

    // Notify the runner (who just claimed it) of the assignment details.
    try {
      const runnerNotificationPayload = {
        userId: runnerUserId,
        message: `You have successfully claimed the errand "${serviceRequestResource.name}"!`,
        data: {
          errandId: errand._id.toString(),
          resourceId: serviceRequestId,
          type: 'errand_claimed_confirmation',
          requesterId: requesterId,
          errandName: serviceRequestResource.name
        }
      };
      await axios.post(NODEJS_NOTIFICATION_URL, runnerNotificationPayload, { timeout: 5000 });
      console.log(`Backend - Confirmation notification sent to runner ${runnerUserId}.`);
    } catch (notifError) {
      console.error(`Backend - Failed to send confirmation notification to runner ${runnerUserId}:`, notifError.message);
    }


  } catch (transactionError) {
    await session.abortTransaction();
    console.error('Backend - Transaction failed during errand claim:', transactionError);
    let errorMessage = 'Internal server error during errand claim.';
    if (transactionError.code === 11000) { // Example for duplicate key error
      errorMessage = 'A similar errand claim might already be in progress.';
    }
    res.status(500).json({ message: errorMessage, error: transactionError.message });
  } finally {
    session.endSession();
  }
});
// Middleware to check if the authenticated user is the assigned runner for the errand
async function isAssignedRunner(req, res, next) {
  try {
    const errandId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(errandId)) {
      return res.status(400).json({ message: 'Invalid Errand ID format.' });
    }

    const errand = await Errand.findById(errandId);
    if (!errand) {
      return res.status(404).json({ message: 'Errand not found.' });
    }

    if (!req.user || req.user._id.toString() !== errand.errandRunner.toString()) {
      return res.status(403).json({ message: 'Forbidden: You are not the assigned runner for this errand.' });
    }
    req.errand = errand; // Attach errand to request for later use
    next();
  } catch (error) {
    console.error('Error in isAssignedRunner middleware:', error);
    res.status(500).json({ message: 'Internal server error during authorization check.' });
  }
}

router.get("/", async (req, res) => {
  try {
    const currentUserId = req.user?.userId;
    const userIdQueryParam = req.query.userId;
    const status = req.query.status;

    let filter = {};

    if (currentUserId) {
      filter.requester = currentUserId;
    } else if (userIdQueryParam) {
      console.warn("Fetching errands filtered by userId query param without authentication.");
      filter.requester = userIdQueryParam;
    }

    if (status && status !== "all") {
      filter.status = status;
    }

    const errands = await Errand.find(filter).populate("requester resource").lean();

    const errandsWithType = errands.map(errand => ({
      ...errand,
      type: "errand",
    }));

    res.json(errandsWithType);
  } catch (err) {
    console.error("Error in /api/errand/:", err);
    res.status(500).json({ message: err.message });
  }
});

// --- Endpoint to Get a specific Errand by ID ---
// Apply authentication middleware to protect this endpoint (if needed)
router.get('/:id', async (req, res) => {
  try {
    const errandId = req.params.id;

    // Find the errand by ID and populate all necessary referenced documents
    const errand = await Errand.findById(errandId)
      // Populate user details for the requester
      .populate('requester', 'username name')
      // Populate the resource request (if it exists)
      .populate('resourceRequestId', 'name description media price type')
      // Populate the errandRunner (the user assigned to do the errand)
      .populate('errandRunner', 'username name')

    // Check if the errand was found
    if (!errand) {
      return res.status(404).json({ message: 'Errand not found.' });
    }

    // Optional: Add an authorization check
    // if (errand.requester._id.toString() !== req.user._id.toString() &&
    //     errand.errandRunner?._id.toString() !== req.user._id.toString()) {
    //   return res.status(403).json({ message: 'Unauthorized access to errand details.' });
    // }

    res.status(200).json(errand);

  } catch (error) {
    console.error(`Error fetching errand with ID ${req.params.id}:`, error);
    res.status(500).json({ message: 'Server error while fetching errand details.', error: error.message });
  }
});

// --- Endpoint to Apply a Coupon to an Errand ---
// Endpoint: PUT /api/errand/:id/coupon
// Applies a coupon code, calculates discount, updates errand finalAmount
router.put('/:id/coupon',
  // authenticateToken, // Apply your authentication middleware here
  async (req, res) => {
    const errandId = req.params.id;
    const userId = req.user._id; // Get authenticated user ID (from auth middleware)
    const { couponCode } = req.body; // Expect coupon code in the request body

    // Validate if errandId is a valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(errandId)) {
      return res.status(400).json({ message: 'Invalid Errand ID format.' });
    }

    if (!couponCode || typeof couponCode !== 'string' || couponCode.trim() === '') {
      return res.status(400).json({ message: 'Coupon code is required.' });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // 1. Find the Errand
      const errand = await Errand.findById(errandId).session(session);

      if (!errand) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: 'Errand not found.' });
      }

      // --- Authorization Check ---
      // Only the user who needs to pay for this errand (the requester) should apply a coupon.
      if (!errand.requester.equals(userId)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({ message: 'You are not authorized to apply a coupon to this errand.' });
      }

      // --- Status Check ---
      // Only allow applying coupon if the errand is in a payable status (e.g., 'awaiting_payment')
      const payableStatuses = ['awaiting_payment'];
      if (!payableStatuses.includes(errand.status)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: `Cannot apply coupon in status: ${errand.status}. Errand must be in status ${payableStatuses.join(' or ')}.` });
      }

      // Check if a coupon has already been applied
      // Now checking the couponApplication sub-document
      if (errand.couponApplication && errand.couponApplication.couponId) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: 'A coupon has already been applied to this errand.' });
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

      // Check minimum order amount against the errand's totalAmount
      if (coupon.minimumOrderAmount && errand.totalAmount < coupon.minimumOrderAmount) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: `Minimum order amount of ¥${coupon.minimumOrderAmount.toFixed(2)} required.` });
      }

      // 4. Calculate the Discount
      let discountAmount = 0;
      if (coupon.discountType === 'percentage') {
        discountAmount = errand.totalAmount * (coupon.discountValue / 100);
        if (coupon.maxDiscount && discountAmount > coupon.maxDiscount) {
          discountAmount = coupon.maxDiscount;
        }
      } else if (coupon.discountType === 'fixed_amount') { // Renamed from 'fixed' to 'fixed_amount' as per Coupon schema
        discountAmount = coupon.discountValue;
        if (discountAmount > errand.totalAmount) {
          discountAmount = errand.totalAmount;
        }
      } else {
        await session.abortTransaction();
        session.endSession();
        console.error(`Unknown discount type for coupon ${coupon._id}: ${coupon.discountType}`);
        return res.status(500).json({ message: 'Invalid coupon configuration.' });
      }
      discountAmount = Math.max(0, discountAmount);

      // 5. Update the Errand with coupon application details
      errand.couponApplication = {
        couponId: coupon._id,
        couponCode: coupon.code,
        discountAmount: discountAmount,
        appliedAt: new Date() // Set the application timestamp
      };
      errand.finalAmount = errand.totalAmount - discountAmount; // Recalculate final amount

      await errand.save({ session });

      // 6. Update the Coupon to mark it as used (for single-use or limited-use coupons)
      coupon.usedAt = new Date(); // Mark coupon as used (if single-use)
      coupon.usedOnErrand = errand._id; // Link coupon to the errand it was used on (if applicable)
      await coupon.save({ session });

      await session.commitTransaction();
      session.endSession();

      // 7. Return the Updated Errand (with populated coupon details if needed by frontend)
      const updatedErrand = await Errand.findById(errand._id)
        .populate('couponApplication.couponId') // Populate the actual coupon document within the sub-document
        .populate('requester')
        .populate('provider')
        .populate('serviceRequest')
        .lean();

      res.status(200).json({
        message: 'Coupon applied successfully to errand',
        errand: updatedErrand // Return the updated errand object
      });

    } catch (err) {
      await session.abortTransaction();
      session.endSession();

      console.error(`Error applying coupon ${couponCode} to errand ${errandId}:`, err);
      if (err.name === 'CastError') {
        return res.status(400).json({ message: 'Invalid ID format.' });
      }
      if (err.name === 'ValidationError') { // Handle Mongoose validation errors
        return res.status(400).json({ message: `Validation Error: ${err.message}` });
      }
      res.status(500).json({ message: 'Failed to apply coupon to errand.' });
    }
  }
);


// POST /api/errand/:id/pickup - Runner marks errand as picked up and uploads proof
router.post('/:id/pickup', isAssignedRunner, upload.single('pickupProof'), async (req, res) => {
  console.log(`Backend - Received POST /api/errand/${req.params.id}/pickup request.`);
  const errandId = req.params.id;
  const errand = req.errand; // Errand loaded by isAssignedRunner middleware

  if (!req.file) {
    return res.status(400).json({ message: 'Pickup proof image is required.' });
  }

  if (errand.currentStatus !== 'assigned') {
    return res.status(400).json({ message: `Errand status must be 'assigned' to be picked up. Current status: ${errand.currentStatus}.` });
  }

  try {
    errand.currentStatus = 'picked_up';
    errand.pickedUpAt = new Date();
    errand.pickupProofUrl = `/uploads/${req.file.filename}`; // Store URL relative to uploads directory
    await errand.save();

    res.status(200).json({
      message: 'Errand status updated to picked up successfully.',
      errandId: errand._id,
      currentStatus: errand.currentStatus,
      pickupProofUrl: errand.pickupProofUrl
    });

    // Notify requester that the errand has been picked up
    const requesterId = (await Resource.findById(errand.errandRequestResourceId)).userId.toString();
    const notificationPayload = {
      userId: requesterId,
      message: `Your errand "${(await Resource.findById(errand.errandRequestResourceId)).name}" has been picked up!`,
      data: {
        errandId: errand._id.toString(),
        resourceId: errand.errandRequestResourceId.toString(),
        type: 'errand_picked_up',
        errandName: (await Resource.findById(errand.errandRequestResourceId)).name
      }
    };
    try {
      await axios.post(NODEJS_NOTIFICATION_URL, notificationPayload, { timeout: 5000 });
      console.log(`Backend - Notification sent to requester ${requesterId} for errand picked up.`);
    } catch (notifError) {
      console.error(`Backend - Failed to send notification for errand picked up to requester ${requesterId}:`, notifError.message);
    }

  } catch (error) {
    console.error('Backend - Error updating errand status to picked up:', error);
    res.status(500).json({ message: 'Failed to update errand status to picked up.', error: error.message });
  }
});


// POST /api/errand/:id/dropoff - Runner marks errand as dropped off and uploads proof
router.post('/:id/dropoff', isAssignedRunner, upload.single('dropoffProof'), async (req, res) => {
  console.log(`Backend - Received POST /api/errand/${req.params.id}/dropoff request.`);
  const errandId = req.params.id;
  const errand = req.errand; // Errand loaded by isAssignedRunner middleware

  if (!req.file) {
    return res.status(400).json({ message: 'Dropoff proof image is required.' });
  }

  if (errand.currentStatus !== 'picked_up') {
    return res.status(400).json({ message: `Errand status must be 'picked_up' to be dropped off. Current status: ${errand.currentStatus}.` });
  }

  try {
    errand.currentStatus = 'dropped_off';
    errand.droppedOffAt = new Date();
    errand.dropoffProofUrl = `/uploads/${req.file.filename}`; // Store URL
    await errand.save();

    res.status(200).json({
      message: 'Errand status updated to dropped off successfully.',
      errandId: errand._id,
      currentStatus: errand.currentStatus,
      dropoffProofUrl: errand.dropoffProofUrl
    });

    // Notify requester that the errand has been dropped off
    const requesterId = (await Resource.findById(errand.errandRequestResourceId)).userId.toString();
    const notificationPayload = {
      userId: requesterId,
      message: `Your errand "${(await Resource.findById(errand.errandRequestResourceId)).name}" has been dropped off!`,
      data: {
        errandId: errand._id.toString(),
        resourceId: errand.errandRequestResourceId.toString(),
        type: 'errand_dropped_off',
        errandName: (await Resource.findById(errand.errandRequestResourceId)).name
      }
    };
    try {
      await axios.post(NODEJS_NOTIFICATION_URL, notificationPayload, { timeout: 5000 });
      console.log(`Backend - Notification sent to requester ${requesterId} for errand dropped off.`);
    } catch (notifError) {
      console.error(`Backend - Failed to send notification for errand dropped off to requester ${requesterId}:`, notifError.message);
    }

  } catch (error) {
    console.error('Backend - Error updating errand status to dropped off:', error);
    res.status(500).json({ message: 'Failed to update errand status to dropped off.', error: error.message });
  }
});


// PUT /api/errand/:id/complete - Runner marks errand as completed
router.put('/:id/complete', isAssignedRunner, async (req, res) => {
  console.log(`Backend - Received PUT /api/errand/${req.params.id}/complete request.`);
  const errandId = req.params.id;
  const errand = req.errand; // Errand loaded by isAssignedRunner middleware

  if (errand.currentStatus !== 'dropped_off') {
    return res.status(400).json({ message: `Errand status must be 'dropped_off' to be marked as complete. Current status: ${errand.currentStatus}.` });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. Update Errand status
    errand.currentStatus = 'completed';
    errand.completedAt = new Date();
    await errand.save({ session });

    // 2. Credit runner's wallet - Commission Logic Here
    const runnerId = errand.errandRunner;
    const originalDeliveryFee = errand.deliveryFee; // Store original fee

    if (originalDeliveryFee === undefined || originalDeliveryFee <= 0) {
      throw new Error('Errand delivery fee is invalid or not set.');
    }

    // Fetch runner's user document
    const runnerUser = await User.findById(runnerId).session(session); // <--- ONE DECLARATION HERE
    if (!runnerUser) {
      throw new Error('Runner user profile not found. Cannot calculate commission or award points/credits.');
    }

    // Calculate commission based on runner's credits
    const runnerReceivePercentage = runnerUser.credits;
    const earningsAmount = originalDeliveryFee * (runnerReceivePercentage / 100);

    if (earningsAmount < 0) {
      throw new Error('Calculated runner earnings are negative, which is not allowed.');
    }

    console.log(`Runner ${runnerId} has ${runnerUser.credits} credits. Original delivery fee: RM ${originalDeliveryFee.toFixed(2)}.`);
    console.log(`Platform commission: ${100 - runnerReceivePercentage}%. Runner net earnings: RM ${earningsAmount.toFixed(2)}.`);

    const wallet = await Wallet.findOne({ userId: runnerId }).session(session);

    if (!wallet) {
      throw new Error(`Wallet not found for runner ${runnerId}.`);
    }

    wallet.balance += earningsAmount; // Credit the runner's balance
    wallet.transactions.push({
      type: 'credit',
      amount: earningsAmount,
      description: `Earnings from Errand Completion (ID: ${errandId})`,
      referenceId: errandId,
      referenceModel: 'Errand',
      status: 'completed',
      processedBy: 'System',
    });
    await wallet.save({ session });

    // Award points
    const pointsEarned = Math.floor(earningsAmount);
    if (pointsEarned > 0) {
      runnerUser.points += pointsEarned;
      console.log(`Runner ${runnerUser._id} earned ${pointsEarned} points from Errand ${errandId}.`);
    }

    // Award credits
    let creditsAwarded = 0;
    if (runnerUser.credits < 100) {
      runnerUser.credits += 1;
      creditsAwarded = 1;
      console.log(`Runner ${runnerUser._id} earned 1 credit from Errand ${errandId}. New credits: ${runnerUser.credits}.`);
    } else {
      console.log(`Runner ${runnerUser._id} has maxed out credits (100) from Errand ${errandId}. No credit awarded.`);
    }

    await runnerUser.save({ session }); // Save the updated runner's User document

    await session.commitTransaction();

    // 3. Notifications (moved after successful transaction commit)
    console.log(`Backend - Errand ${errandId} completed and runner wallet credited. Initiate notifications.`);

    // ... rest of your notification logic ...

  } catch (error) {
    await session.abortTransaction(); // Rollback all changes
    console.error('Backend - Error updating errand status to completed and crediting runner wallet:', error);
    res.status(500).json({ message: 'Failed to complete errand and credit runner. Please try again.', error: error.message });
  } finally {
    session.endSession();
  }
});

// Route to initiate a refund request for a Errand
router.put('/:id/refund', requestErrandRefund);

module.exports = router;
