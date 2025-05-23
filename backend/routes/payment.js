const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const router = express.Router();
const fs = require('fs');

// Require your Mongoose models
const Match = require('../models/Match'); // Require Match model explicitly
const Resource = require('../models/Resource');
const User = require('../models/User');
const Wallet = require('../models/Wallet'); // <<<< NEW: Import Wallet model
const Payout = require('../models/Payout'); // <<<< NEW: Import Payout model

// Require the wxpay library you found
const WxPay = require('wxpay');

// --- Get WeChat Pay credentials from environment variables ---
const WECHAT_APP_ID = process.env.WECHAT_APP_ID;
const WECHAT_MCH_ID = process.env.WECHAT_MCH_ID;
const WECHAT_API_KEY = process.env.WECHAT_PARTNER_KEY;
const WECHAT_NOTIFY_URL = process.env.WECHAT_NOTIFY_URL;

// Get paths to certificate files from environment variables
const WECHAT_CERT_PATH = process.env.WECHAT_CERT_PATH;
const WECHAT_KEY_PATH = process.env.WECHAT_KEY_PATH;
const WECHAT_PFX_PATH = process.env.WECHAT_PFX_PATH;

// --- Define DOOR_DELIVERY_FEE consistently (can be moved to a config file) ---
const DOOR_DELIVERY_FEE = 5.00; // RM5 for door delivery (must match frontend)


// --- Initialize the WxPay client/SDK ---
// Create the options object first
const wxPayOptions = {
  appid: WECHAT_APP_ID,
  mch_id: WECHAT_MCH_ID,
  paternerKey: WECHAT_API_KEY, // Corrected name
  notify_url: WECHAT_NOTIFY_URL,
  cert: fs.readFileSync(WECHAT_CERT_PATH),
  key: fs.readFileSync(WECHAT_KEY_PATH),
  // pfx: fs.readFileSync(WECHAT_PFX_PATH), // Uncomment if you use P12
};

// Instantiate WxPay client globally if possible, or ensure it's consistently initialized.
// For the sake of this snippet, I'll instantiate it here.
const wxPayClient = new WxPay(wxPayOptions);


// Middleware to parse raw body for XML (specifically for WeChat Pay notifications)
const rawXmlBodyParser = express.raw({ type: 'text/xml' });

// --- Protected Endpoint to List Payment Methods ---
router.get('/methods', async (req, res) => {
  // Example: return supported methods
  res.status(200).json({
    methods: [
      { label: '微信支付 (小程序)', value: 'WECHAT_PAY_MINIPROGRAM' }
    ]
  });
});


// --- Protected Endpoint to Initiate Payment ---
router.post('/initiate', async (req, res) => {
  // frontend sends: orderId, paymentMethod, isDoorDeliverySelected (for Match), deliveryAddressId, deliveryTime, clientCalculatedTotal
  const { orderId, paymentMethod, isDoorDeliverySelected, deliveryAddressId, deliveryTime, clientCalculatedTotal } = req.body;
  const userId = req.user._id;

  if (!orderId || !paymentMethod) {
    return res.status(400).json({ message: 'Order ID and payment method are required.' });
  }
  if (paymentMethod !== 'WECHAT_PAY_MINIPROGRAM') {
    return res.status(400).json({ message: `Unsupported payment method: ${paymentMethod}. Only WECHAT_PAY_MINIPROGRAM is supported.` });
  }

  let document = null; // This will hold either a Match or a Resource
  let isServiceRequest = false; // Flag to easily check the type
  let amountToPay = 0;
  let orderDescription = '';
  let originalStatus = ''; // To store the original status for potential revert

  try {
    // 1. Determine Order Type and Fetch Document
    // Try to find as a Match first
    document = await Match.findById(orderId);

    if (document) {
      // It's a Match document
      if (!document.requester.equals(userId)) {
        return res.status(403).json({ message: 'You are not authorized to initiate payment for this match.' });
      }
      // Ensure match status is 'accepted' to initiate payment
      if (document.status !== 'accepted') {
        return res.status(400).json({ message: `Match status must be 'accepted' to initiate payment. Current status: ${document.status}` });
      }

      amountToPay = document.agreedPrice; // Base price from the match

      // Apply door delivery fee if selected for a Match (from frontend request)
      if (isDoorDeliverySelected) {
        amountToPay += DOOR_DELIVERY_FEE;
      }

      // Account for applied coupon if present in the Match document (finalAmount should reflect this)
      if (document.appliedCoupon && document.finalAmount !== undefined) {
        amountToPay = document.finalAmount; // Use the backend's calculated finalAmount after coupon
      }

      orderDescription = `Payment for Match ${document._id}`;

    } else {
      // If not a Match, try to find as a Resource (specifically service-request)
      document = await Resource.findById(orderId);

      if (document && document.type === 'service-request') {
        isServiceRequest = true;
        // For service-request, the owner (creator) is the one who pays
        if (!document.owner.equals(userId)) {
          return res.status(403).json({ message: 'You are not authorized to initiate payment for this service request.' });
        }
        // Check status: only allow payment if 'submitted'
        if (document.status !== 'submitted') {
          return res.status(400).json({ message: `Service request status must be 'submitted' to initiate payment. Current status: ${document.status}` });
        }

        originalStatus = document.status; // Store original status before changing
        amountToPay = document.price; // This should be the final price including any door delivery etc.
        orderDescription = `Payment for Service Request ${document._id}`;

        // Update resource status from 'submitted' to 'pending'
        // This indicates that payment process has started on the client side.
        document.status = 'pending';
        await document.save();
        console.log(`Service request ${document._id} status updated from '${originalStatus}' to 'pending' prior to payment initiation.`);

      } else {
        return res.status(404).json({ message: 'Order (Match or Service Request) not found.' });
      }
    }

    // Validate clientCalculatedTotal against backend calculated `amountToPay`
    const backendCalculatedTotalCents = Math.round(amountToPay * 100);
    const clientCalculatedTotalCents = Math.round(clientCalculatedTotal * 100);

    if (backendCalculatedTotalCents !== clientCalculatedTotalCents) {
      console.warn(`Price mismatch for order ${orderId}: Client calculated ${clientCalculatedTotal} vs Backend calculated ${amountToPay}. Using backend price.`);
      // In a production environment, you might want to throw an error here or log it more seriously.
      // For now, we will proceed with the backend's calculated amount.
    }

    // Get the user's OpenID from the User model
    const user = await User.findById(userId).select('wechatOpenId');

    if (!user || !user.wechatOpenId) {
      return res.status(400).json({ message: 'User WeChat OpenID not found. Cannot process WeChat Pay.' });
    }
    const openid = user.wechatOpenId;

    // 2. Prepare Parameters for WeChat Pay Unified Order API
    const unifiedOrderParams = {
      appid: WECHAT_APP_ID, // Use env var
      mch_id: WECHAT_MCH_ID, // Use env var
      nonce_str: wxPayClient.nonceStr || Math.random().toString(36).substr(2, 15), // Use SDK method or generate
      body: orderDescription,
      out_trade_no: document._id.toString(), // Your unique order/match/resource ID
      total_fee: backendCalculatedTotalCents, // Amount in CENTS, using backend calculated value
      spbill_create_ip: req.ip || '127.0.0.1', // User's IP
      notify_url: WECHAT_NOTIFY_URL, // Use env var
      trade_type: 'JSAPI', // For Mini-Program
      openid: openid, // User's OpenID
    };

    // 3. Call the WxPay library method to send the Unified Order request
    const result = await wxPayClient.unifiedOrder(unifiedOrderParams);

    // 4. Process the result from the wxPayClient.unifiedOrder call
    if (result && result.return_code === 'SUCCESS' && result.result_code === 'SUCCESS') {
      const prepayId = result.prepay_id;

      // 5. Prepare Parameters for Frontend (Taro.requestPayment)
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const nonceStr = wxPayClient.nonceStr || Math.random().toString(36).substr(2, 15);
      const pkg = `prepay_id=${prepayId}`;

      const frontendParamsToSign = {
        appId: WECHAT_APP_ID,
        timeStamp: timestamp,
        nonceStr: nonceStr,
        package: pkg,
        signType: 'MD5', // Or 'HMAC-SHA256' - Must match what you sign with
      };

      // 6. Sign the frontend parameters using the WxPay library
      const paySign = wxPayClient.sign(frontendParamsToSign, frontendParamsToSign.signType);

      // 7. Return Parameters to Frontend
      const finalFrontendParams = {
        timeStamp: timestamp,
        nonceStr: nonceStr,
        package: pkg,
        signType: frontendParamsToSign.signType,
        paySign: paySign,
      };

      res.status(200).json({
        message: 'Payment initiation successful',
        paymentParams: finalFrontendParams,
      });

    } else {
      console.error('WeChat Pay Unified Order API error result:', result);
      const errorMessage = result.return_msg || result.err_code_des || 'Failed to create WeChat Pay order.';

      // If payment initiation failed for a service-request, revert its status
      if (isServiceRequest && document.status === 'pending') {
        document.status = originalStatus; // Revert to original (likely 'submitted')
        await document.save();
        console.warn(`Service request ${document._id} status reverted to '${originalStatus}' due to payment initiation failure.`);
      }

      res.status(500).json({ message: errorMessage });
    }

  } catch (error) {
    console.error('Error during payment initiation process:', error);
    const errorMessage = error.message || 'An internal error occurred during payment initiation.';

    // Attempt to revert status for service-request if an error occurred before successful response
    // This needs to be careful not to interfere with successful updates.
    if (document && isServiceRequest && document.status === 'pending') {
      // Only revert if it was a service request and its status was changed to 'pending'
      // and the error happened during the payment initiation flow.
      document.status = originalStatus; // Revert to original (likely 'submitted')
      await document.save();
      console.warn(`Service request ${document._id} status reverted to '${originalStatus}' due to an error during payment initiation.`);
    }

    res.status(500).json({ message: errorMessage });
  }
});

// --- New Endpoint: Initiate Runner Payout ---
router.post('/payout', async (req, res) => {
  const { amount, description = 'Runner earnings payout' } = req.body; // amount in RM
  const runnerId = req.user._id; // Assuming req.user contains the authenticated runner's ID

  if (!runnerId) {
    return res.status(401).json({ message: 'Authentication required for payout.' });
  }
  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ message: 'Invalid payout amount.' });
  }

  const payoutAmountCents = Math.round(amount * 100); // Convert RM to cents

  // Minimum and maximum payout limits (can be configurable)
  const MIN_PAYOUT_AMOUNT_CENTS = 100; // e.g., RM 1.00
  const MAX_PAYOUT_AMOUNT_CENTS = 2000000; // e.g., RM 20000.00

  if (payoutAmountCents < MIN_PAYOUT_AMOUNT_CENTS || payoutAmountCents > MAX_PAYOUT_AMOUNT_CENTS) {
    return res.status(400).json({
      message: `Payout amount must be between RM ${MIN_PAYOUT_AMOUNT_CENTS / 100} and RM ${MAX_PAYOUT_AMOUNT_CENTS / 100}.`
    });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. Find Runner and their Wallet
    const runner = await User.findById(runnerId).session(session);
    if (!runner) {
      throw new Error('Runner not found.');
    }
    if (!runner.isRunner) { // Only allow users marked as runners to request payouts
      throw new Error('User is not registered as a runner and cannot request payouts.');
    }

    const wallet = await Wallet.findOne({ owner: runnerId }).session(session);
    if (!wallet) {
      throw new Error('Runner wallet not found. Please contact support.');
    }

    if (wallet.balance * 100 < payoutAmountCents) { // Compare in cents
      throw new Error(`Insufficient wallet balance. Current: RM ${wallet.balance.toFixed(2)}, Requested: RM ${amount.toFixed(2)}`);
    }

    if (!runner.wechatOpenId) {
      throw new Error('Runner WeChat OpenID not found. Cannot process payout.');
    }

    // 2. Generate Unique Payout ID
    const partnerTradeNo = `PAYOUT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // 3. Create a Payout record (status: 'pending')
    const newPayout = new Payout({
      runner: runnerId,
      amount: amount, // Store in RM
      wechatOpenId: runner.wechatOpenId,
      partnerTradeNo: partnerTradeNo,
      description: description,
      status: 'pending',
    });
    await newPayout.save({ session });

    // 4. Deduct amount from runner's wallet
    wallet.balance -= amount; // Deduct in RM
    wallet.transactions.push({
      type: 'debit',
      amount: amount,
      description: `WeChat Pay Payout (ID: ${newPayout._id})`,
      sourceId: newPayout._id,
      sourceModel: 'Payout',
    });
    await wallet.save({ session });

    // 5. Call WeChat Pay MCH Payout API
    const payoutParams = {
      partner_trade_no: partnerTradeNo,
      openid: runner.wechatOpenId,
      check_name: 'NO_CHECK', // Or 'FORCE_CHECK' if you have the real name
      // re_user_name: 'Real Name', // Required if check_name is 'FORCE_CHECK'
      amount: payoutAmountCents, // Amount in CENTS
      desc: description,
      spbill_create_ip: req.ip || '127.0.0.1',
    };

    console.log('Initiating WeChat Pay MCH Payout with params:', payoutParams);
    const payoutResult = await wxPayClient.mchPay(payoutParams); // Assuming mchPay is the method for payouts

    console.log('WeChat Pay MCH Payout Result:', payoutResult);

    if (payoutResult && payoutResult.return_code === 'SUCCESS' && payoutResult.result_code === 'SUCCESS') {
      // Payout request was successful, update payout status
      newPayout.status = 'successful';
      newPayout.wechatPaymentNo = payoutResult.payment_no; // WeChat's internal payment number
      await newPayout.save({ session });

      await session.commitTransaction();
      res.status(200).json({ message: 'Payout successfully initiated.', payoutId: newPayout._id, wechatPaymentNo: payoutResult.payment_no });
    } else {
      // Payout failed on WeChat side, rollback wallet deduction
      throw new Error(payoutResult.return_msg || payoutResult.err_code_des || 'WeChat Pay payout failed.');
    }

  } catch (error) {
    await session.abortTransaction(); // Rollback any changes
    console.error('Error during runner payout process:', error);
    // If the error is a known validation/business logic error, send a specific message
    const userFacingError = error.message.includes('wallet balance') ||
      error.message.includes('Runner not found') ||
      error.message.includes('OpenID not found') ||
      error.message.includes('Runner not registered') ||
      error.message.includes('Payout amount') ? error.message : 'An internal server error occurred during payout.';
    res.status(500).json({ message: userFacingError });
  } finally {
    session.endSession();
  }
});


// --- Endpoint to Receive WeChat Pay Notifications ---
router.post('/notify', rawXmlBodyParser, async (req, res) => {
  const xmlBody = req.body;

  if (!xmlBody) {
    console.error('WeChat Pay notification: Empty XML body received.');
    return res.set('Content-Type', 'text/xml').status(400).send(wxPayClient.buildFailureXmlResponse('Empty XML body'));
  }

  try {
    const notificationData = await wxPayClient.parseXml(xmlBody.toString());
    console.log('Parsed Notification Data:', notificationData);

    if (notificationData.return_code !== 'SUCCESS' || notificationData.result_code !== 'SUCCESS') {
      console.error('WeChat Pay notification indicates failure:', notificationData);
      return res.set('Content-Type', 'text/xml').status(200).send(wxPayClient.buildFailureXmlResponse(notificationData.return_msg || 'Payment not successful'));
    }

    const isSignatureValid = wxPayClient.verifyNotifySign(notificationData);
    console.log('Notification Signature Valid:', isSignatureValid);

    if (isSignatureValid) {
      // Payment was successful and signature is verified
      const orderId = notificationData.out_trade_no; // This is the _id of the Match or Resource
      const totalFeePaid = parseInt(notificationData.total_fee, 10);

      let document = null;
      let isServiceRequest = false;

      // Try to find as a Match first
      document = await Match.findById(orderId);

      if (!document) {
        // If not a Match, try to find as a Resource
        document = await Resource.findById(orderId);
        if (document && document.type === 'service-request') {
          isServiceRequest = true;
        } else {
          console.error(`Order (Match or Service Request) ${orderId} not found in DB from WeChat Pay notification.`);
          return res.set('Content-Type', 'text/xml').status(200).send(wxPayClient.buildFailureXmlResponse('Order Not Found'));
        }
      }

      if (document) {
        const expectedAmountCents = Math.round((isServiceRequest ? document.price : (document.finalAmount !== undefined ? document.finalAmount : document.agreedPrice)) * 100);

        // Only update if payment is pending and amounts match
        // This is where the status change to 'paid' happens for both types
        const statusOrder = ['submitted', 'pending', 'accepted', 'paid', 'erranding', 'completed', 'canceled', 'declined'];
        const currentStatusIndex = statusOrder.indexOf(document.status);
        const paidStatusIndex = statusOrder.indexOf('paid');

        // Check if the current status is before 'paid' and the paid amount matches
        if (currentStatusIndex < paidStatusIndex && totalFeePaid === expectedAmountCents) {
          if (isServiceRequest) {
            document.status = 'paid'; // Service request moves from 'pending' to 'paid'
            document.paymentStatus = 'paid';
            document.paidAt = new Date();
            document.wechatTransactionId = notificationData.transaction_id;
            await document.save();
            console.log(`Service Request ${orderId} status updated to 'paid' from notification.`);
          } else { // It's a Match
            document.status = 'paid'; // Match moves from 'accepted' to 'paid'
            document.paymentStatus = 'paid';
            document.paidAt = new Date();
            document.wechatTransactionId = notificationData.transaction_id;
            await document.save();
            console.log(`Match ${orderId} status updated to 'paid' from notification.`);

            // Additional logic for Match post-payment, e.g., initiate errand prompt
            // This logic is typically on the frontend after payment success, or
            // a background process might be triggered here.
          }
        } else {
          console.warn(`Notification received for order ${orderId} but conditions not met for update (status: ${document.status}, paid amount: ${totalFeePaid}, expected: ${expectedAmountCents}).`);
        }

        res.set('Content-Type', 'text/xml').status(200).send(wxPayClient.buildSuccessXmlResponse());

      } else {
        console.error(`Order (Match or Resource) ${orderId} not found in DB after initial lookup.`);
        res.set('Content-Type', 'text/xml').status(200).send(wxPayClient.buildFailureXmlResponse('Order Not Found After Initial Lookup'));
      }

    } else {
      console.error('WeChat Pay notification processing failed (Invalid Signature):', notificationData);
      res.set('Content-Type', 'text/xml').status(200).send(wxPayClient.buildFailureXmlResponse('Signature Error'));
    }

  } catch (error) {
    console.error('Error processing WeChat Pay notification:', error);
    res.status(500).send(wxPayClient.buildFailureXmlResponse('Internal Server Error'));
  }
});


// Export the router
module.exports = router;
