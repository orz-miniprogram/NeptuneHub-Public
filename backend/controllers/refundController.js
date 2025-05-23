// backend/controllers/refundController.js
const asyncHandler = require('express-async-handler'); // For cleaner async error handling
const RefundRequest = require('../models/RefundRequest'); // Adjust path as needed
const Resource = require('../models/Resource'); // Adjust path as needed
const Errand = require('../models/Errand'); // Adjust path as needed
const Match = require('../models/Match');   // Adjust path as needed
const { calculateRefundAmount } = require('../utils/refundHelper'); // Adjust path as needed

// Helper function to check and process a refund request for a given item type
const processRefundRequest = async (req, res, itemId, itemModel, itemType) => {
    const userId = req.user.id; // From protect middleware
    const { reason } = req.body; // Optional reason for the refund request

    // 1. Fetch the item document
    let item;
    try {
        // Populate resourceId for Errand and Match to access original pricing details
        if (itemType === 'errand' || itemType === 'match') {
            item = await itemModel.findById(itemId).populate('resourceId');
        } else {
            item = await itemModel.findById(itemId);
        }
    } catch (error) {
        console.error(`Error fetching ${itemType} with ID ${itemId}:`, error);
        return res.status(500).json({ message: `Error fetching ${itemType}.` });
    }

    if (!item) {
        return res.status(404).json({ message: `${itemType.charAt(0).toUpperCase() + itemType.slice(1)} not found.` });
    }

    // 2. Authorization: Ensure the requesting user is associated with the item
    let isOwner = false;
    switch (itemType) {
        case 'resource':
            // Assuming `userId` field on Resource model for the creator/buyer
            if (item.userId && item.userId.toString() === userId.toString()) isOwner = true;
            break;
        case 'errand':
            // Assuming `userId` field on Errand model for the service requester
            if (item.userId && item.userId.toString() === userId.toString()) isOwner = true;
            break;
        case 'match':
            // Assuming `requesterId` field on Match model for the buyer/service requester
            if (item.requesterId && item.requesterId.toString() === userId.toString()) isOwner = true;
            break;
    }

    // For Errand/Match, also check ownership of the linked Resource
    if (!isOwner && item.resourceId) {
        const associatedResource = item.resourceId; // Already populated
        if (associatedResource && associatedResource.userId && associatedResource.userId.toString() === userId.toString()) {
            isOwner = true;
        }
    }

    if (!isOwner) {
        return res.status(403).json({ message: `Not authorized to request refund for this ${itemType}.` });
    }

    // 3. Check for existing active refund request
    if (item.refundRequestId) {
        const existingRefundRequest = await RefundRequest.findById(item.refundRequestId);
        if (existingRefundRequest && (existingRefundRequest.status === 'pending' || existingRefundRequest.status === 'approved')) {
            return res.status(400).json({ message: `A refund request for this ${itemType} is already pending or approved.` });
        }
    }

    // 4. Calculate Refund Amount using the helper
    // Ensure `itemData` for the helper has the necessary `resourceId` populated
    const refundCalculationParams = {
        resource: item.resourceId || item, // Pass the populated resource (or item itself if it's a Resource)
        itemType: itemType,
        itemData: item, // Pass the original item data (Errand/Match/Resource)
        currentTime: new Date() // Pass current server time for 'expired' checks
    };

    // The calculateRefundAmount function determines refund eligibility based on status and context
    const calculatedAmount = calculateRefundAmount(refundCalculationParams.itemType, refundCalculationParams.itemData, { currentTime: refundCalculationParams.currentTime });

    if (calculatedAmount <= 0) {
        // Refund amount is 0, meaning no refund is applicable for current status/conditions
        return res.status(400).json({ message: `No refund is applicable for this ${itemType} in its current status.` });
    }

    // 5. Create the new RefundRequest document
    let refundRequest;
    try {
        refundRequest = await RefundRequest.create({
            userId: userId,
            amount: calculatedAmount,
            reason: reason || `Refund requested for ${itemType} ID: ${itemId}`,
            status: 'pending', // All requests start as pending for review
            // Link to the primary item for which the refund was requested
            resourceId: itemType === 'resource' ? item._id : item.resourceId ? item.resourceId._id : null,
            errandId: itemType === 'errand' ? item._id : null,
            matchId: itemType === 'match' ? item._id : null,
        });
    } catch (error) {
        console.error(`Error creating RefundRequest for ${itemType} ID ${itemId}:`, error);
        return res.status(500).json({ message: `Error submitting refund request for ${itemType}.` });
    }


    // 6. Update the item document with the new refundRequestId
    try {
        item.refundRequestId = refundRequest._id;
        await item.save();
    } catch (error) {
        console.error(`Error updating ${itemType} with refundRequestId for ID ${itemId}:`, error);
        // Consider compensating for the created RefundRequest here (e.g., marking it failed)
        return res.status(500).json({ message: `Failed to link refund request to ${itemType}.` });
    }

    // 7. Respond
    res.status(201).json({
        message: `Refund request for ${itemType} submitted successfully. It is now pending approval.`,
        refundRequest,
        calculatedRefundAmount: calculatedAmount,
    });
};

// @desc    Request a refund for a Resource
// @route   PUT /api/resource/:id/refund
// @access  Private (User)
const requestResourceRefund = asyncHandler(async (req, res) => {
    await processRefundRequest(req, res, req.params.id, Resource, 'resource');
});

// @desc    Request a refund for a Match
// @route   PUT /api/match/:id/refund
// @access  Private (User)
const requestMatchRefund = asyncHandler(async (req, res) => {
    await processRefundRequest(req, res, req.params.id, Match, 'match');
});

// @desc    Request a refund for an Errand
// @route   PUT /api/errand/:id/refund
// @access  Private (User)
const requestErrandRefund = asyncHandler(async (req, res) => {
    await processRefundRequest(req, res, req.params.id, Errand, 'errand');
});

module.exports = {
    requestResourceRefund,
    requestMatchRefund,
    requestErrandRefund,
};
