// backend/utils/refundHelper.js

const { DateTime } = require('luxon'); // Using Luxon for easier date/time handling
// Make sure to install Luxon: npm install luxon

// Define the AUTO_COMPLETE_TIME_WINDOW_MINUTES constant
// This should match the logic used for determining 'expired' status for resources.
const AUTO_COMPLETE_TIME_WINDOW_MINUTES = 30; // 30 minutes after start/arrival time

// Define the flat door delivery fee (in RM)
const FLAT_DOOR_DELIVERY_FEE = 5.00; // Must match your price calculation logic

/**
 * Calculates the eligible refund amount based on the item type and its current status.
 *
 * @param {string} itemType - The type of the item ('resource', 'errand', 'match').
 * @param {object} itemData - The Mongoose document for the item (Resource, Errand, or Match), potentially populated.
 * @param {object} [options={}] - Additional options, e.g., current time for expiry check.
 * @param {Date} [options.currentTime=new Date()] - The current time to use for expiry checks.
 * @returns {number} The calculated refund amount (in RM). Returns 0 if no refund is applicable.
 * @throws {Error} If itemType is invalid or required data is missing/invalid for calculation.
 */
const calculateRefundAmount = (itemType, itemData, options = {}) => {
  const currentTime = options.currentTime || new Date();

  if (!itemData) {
    throw new Error(`Cannot calculate refund for null or undefined itemData.`);
  }

  let refundAmount = 0;
  // Use 'status' for Resource/Match, 'currentStatus' for Errand (if that's your field)
  const currentStatus = itemData.status || itemData.currentStatus;

  // --- Helper to calculate Door Delivery Fee (Flat 5 units if applicable) ---
  const getDoorDeliveryFee = (resourceDoc) => {
    return resourceDoc.specifications?.door_delivery ? FLAT_DOOR_DELIVERY_FEE : 0;
  };

  // --- Calculate the base errand fee (`minPrice`) by reverse engineering ---
  // Based on your clarification: `resource.price` (the final paid price, excluding tips)
  // contains `minPrice` and `doorDeliveryFee`.
  // This `resource.price` is found on the Resource document linked to the Errand/Match.
  // We need to ensure itemData is the Resource for this calculation or has the necessary fields.
  let associatedResourceData = itemData; // Assume itemData is Resource initially for simplified access
  if (itemType === 'errand' && itemData.resourceId && itemData.resourceId.price) {
    // If itemData is Errand, and resourceId is populated with the Resource document
    associatedResourceData = itemData.resourceId;
  } else if (itemType === 'match' && itemData.resourceId && itemData.resourceId.price) {
    // If itemData is Match, and resourceId is populated with the Resource document
    associatedResourceData = itemData.resourceId;
  }
  // Fallback if resourceId is not populated or missing price
  const originalResourcePriceExcludingTips = associatedResourceData.price || 0;
  const tips = associatedResourceData.specifications?.tips || 0;
  const doorDeliveryFee = getDoorDeliveryFee(associatedResourceData);

  // This is the `minPrice` (base errand fee) that was part of the `resource.price`
  const errandBaseMinPrice = originalResourcePriceExcludingTips - doorDeliveryFee;

  // Total amount the user paid for the resource/service, including tips.
  const totalOriginalPaidAmount = originalResourcePriceExcludingTips + tips;


  switch (itemType) {
    case 'resource':
      // Assuming this is specifically for 'service-request' resources that have been paid for
      if (itemData.type !== 'service-request') {
        console.warn(`Refund requested for non-service-request resource type: ${itemData.type}. Returning 0 refund.`);
        return 0;
      }

      if (currentStatus === 'matching' || currentStatus === 'pending') {
        // Full refund if paid but not yet matched/assigned
        refundAmount = totalOriginalPaidAmount;
        console.log(`Resource ${itemData._id} in status '${currentStatus}'. Full refund of ${refundAmount} calculated.`);
      } else if (currentStatus === 'canceled') {
        // No refund for manually cancelled resources (before payment or in non-refundable state)
        refundAmount = 0;
        console.log(`Resource ${itemData._id} in status 'canceled'. No refund.`);
      } else {
        // Check for 'expired' status based on timeframe for service-request resources
        const specs = itemData.specifications || {};
        const startingTime = specs.starting_time ? DateTime.fromISO(specs.starting_time) : null;
        const arrivalTime = specs.arrival_time ? DateTime.fromISO(specs.arrival_time) : null;
        const now = DateTime.fromJSDate(currentTime); // Use Luxon for current time

        let isExpired = false;
        // Check only if the resource status is not already matched/completed/cancelled
        if (currentStatus !== 'matched' && currentStatus !== 'completed' && currentStatus !== 'cancelled') {
          if (startingTime && now >= startingTime.plus({ minutes: AUTO_COMPLETE_TIME_WINDOW_MINUTES })) {
            isExpired = true;
          } else if (arrivalTime && now >= arrivalTime.plus({ minutes: AUTO_COMPLETE_TIME_WINDOW_MINUTES })) {
            isExpired = true;
          }
        }


        if (isExpired) {
          // Full refund if the service-request expired
          refundAmount = totalOriginalPaidAmount;
          console.log(`Resource ${itemData._id} is expired. Full refund of ${refundAmount} calculated.`);
        } else {
          // For any other status not explicitly handled (e.g., 'matched', 'completed' if applicable), no refund
          refundAmount = 0;
          console.log(`Resource ${itemData._id} in status '${currentStatus}' (not expired/refundable). No refund.`);
        }
      }
      break;

    case 'errand':
      // Refund conditions for Errand instances (after a service-request is matched and assigned)
      if (currentStatus === 'pending') {
        // Full refund if the errand hasn't been accepted by the runner yet
        // Assuming 'deliveryFee' on Errand document reflects the base errand fee paid
        const errandPrice = itemData.deliveryFee || 0; // This should be the minPrice for the errand
        const errandTips = associatedResourceData.specifications?.tips || 0; // Tips from original Resource
        const errandDoorDeliveryFee = getDoorDeliveryFee(associatedResourceData); // Door delivery fee from original Resource
        refundAmount = errandPrice + errandTips + errandDoorDeliveryFee;
        console.log(`Errand ${itemData._id} in status 'pending'. Full refund (${refundAmount}) calculated.`);

      } else if (currentStatus === 'assigned') {
        // Refund tips and door delivery fee (if applicable)
        const errandTips = associatedResourceData.specifications?.tips || 0;
        refundAmount = errandTips + doorDeliveryFee;
        console.log(`Errand ${itemData._id} in status 'assigned'. Tips (${errandTips}) and Door delivery fee (${doorDeliveryFee}) refund calculated.`);

      } else if (currentStatus === 'picked_up') {
        // Refund only door delivery fee (if applicable)
        refundAmount = doorDeliveryFee;
        console.log(`Errand ${itemData._id} in status 'picked_up'. Door delivery fee (${doorDeliveryFee}) refund calculated.`);

      } else if (currentStatus === 'dropped_off' || currentStatus === 'cancelled' || currentStatus === 'completed') {
        // No refund for these statuses. The 'expired' status does not apply to Errand model.
        refundAmount = 0;
        console.log(`Errand ${itemData._id} in status '${currentStatus}'. No refund.`);
      } else {
        refundAmount = 0; // Catch-all for undefined statuses
        console.log(`Errand ${itemData._id} in unrecognized status '${currentStatus}'. No refund.`);
      }
      break;

    case 'match':
      // Refund conditions for Match instances
      const matchFinalAmount = itemData.finalAmount || 0; // The final amount paid by the requester for the match

      if (currentStatus === 'paid') {
        // Full refund (of the amount paid for the match)
        refundAmount = matchFinalAmount;
        console.log(`Match ${itemData._id} in status 'paid'. Full refund of ${refundAmount} calculated.`);

      } else if (currentStatus === 'erranding') {
        // Deducted refund: finalAmount minus the base errand fee (`minPrice`)
        refundAmount = matchFinalAmount - errandBaseMinPrice;
        if (refundAmount < 0) refundAmount = 0; // Ensure refund amount is not negative

        console.log(`Match ${itemData._id} in status 'erranding'. Deducted refund (${refundAmount}) calculated (Original paid: ${matchFinalAmount}, Deduction: ${errandBaseMinPrice}).`);

      } else if (currentStatus === 'pending' || currentStatus === 'accepted' || currentStatus === 'completed' || currentStatus === 'cancelled') {
        // No refund for these statuses via this process.
        // 'Pending' and 'accepted' imply no payment, or payment is pending.
        // 'Completed' and 'cancelled' implies service delivered or past refund window.
        refundAmount = 0;
        console.log(`Match ${itemData._id} in status '${currentStatus}'. No refund.`);
      } else {
        refundAmount = 0; // Catch-all for undefined statuses
        console.log(`Match ${itemData._id} in unrecognized status '${currentStatus}'. No refund.`);
      }
      break;

    default:
      console.error(`Unknown item type for refund calculation: ${itemType}`);
      throw new Error(`Invalid item type for refund calculation: ${itemType}`);
  }

  // Ensure refund amount is non-negative
  return Math.max(0, refundAmount);
};

module.exports = {
  calculateRefundAmount,
};
