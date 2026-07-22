const express = require('express');
const { sequelize, MpesaTransaction, Contribution, Repayment, Member } = require('../models');
const { requireAdmin, getMemberFromRequest } = require('../adminContext');

const router = express.Router();

function ok(res, data) { return res.json({ status: 'success', message: 'OK', data }); }
function fail(res, code, message) { return res.status(code).json({ status: 'fail', message }); }

// Helper to get Safaricom Access Token
async function getDarajaToken() {
  const consumerKey = process.env.DARAJA_CONSUMER_KEY;
  const consumerSecret = process.env.DARAJA_CONSUMER_SECRET;
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

  const url = process.env.DARAJA_ENV === 'production'
    ? 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
    : 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';

  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Authorization': `Basic ${auth}` }
  });

  if (!response.ok) {
    throw new Error('Failed to fetch Safaricom OAuth token');
  }

  const data = await response.json();
  return data.access_token;
}

// POST /api/mpesa/stk-push
router.post('/stk-push', async (req, res) => {
  try {
    const member = getMemberFromRequest(req);
    // STK pushes can be done by a member (using member token) or admin. Let's resolve the member or admin.
    const memberId = member ? member.id : req.body.member_id;
    const { amount, phone, purpose, admin_id } = req.body;

    if (!amount || !phone) {
      return fail(res, 400, 'Amount and Phone are required.');
    }

    // Format phone to 254XXXXXXXXX
    let formattedPhone = phone.trim().replace(/\+/g, '');
    if (formattedPhone.startsWith('0')) {
      formattedPhone = '254' + formattedPhone.substring(1);
    } else if (formattedPhone.startsWith('7') || formattedPhone.startsWith('1')) {
      formattedPhone = '254' + formattedPhone;
    }

    const token = await getDarajaToken();
    const shortcode = process.env.DARAJA_SHORTCODE || '174379';
    const passkey = process.env.DARAJA_PASSKEY;
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const password = Buffer.from(shortcode + passkey + timestamp).toString('base64');
    const callbackUrl = process.env.DARAJA_CALLBACK_URL;

    const requestBody = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(Number(amount)),
      PartyA: formattedPhone,
      PartyB: shortcode,
      PhoneNumber: formattedPhone,
      CallBackURL: callbackUrl,
      AccountReference: purpose || 'ChamaPayment',
      TransactionDesc: purpose || 'Table Banking'
    };

    const url = process.env.DARAJA_ENV === 'production'
      ? 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
      : 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const responseData = await response.json();

    if (responseData.ResponseCode === '0') {
      // Save Transaction in database
      const transaction = await MpesaTransaction.create({
        member_id: memberId || null,
        amount: Number(amount),
        phone: formattedPhone,
        purpose: purpose || 'General Contribution',
        status: 'pending',
        checkout_request_id: responseData.CheckoutRequestID,
        merchant_request_id: responseData.MerchantRequestID,
        admin_id: admin_id || (member ? member.admin_id : null)
      });

      return ok(res, {
        message: 'STK Push initiated successfully',
        transactionId: transaction.id,
        checkoutRequestId: responseData.CheckoutRequestID
      });
    } else {
      return fail(res, 400, responseData.ResponseDescription || 'Safaricom STK Push failed');
    }
  } catch (err) {
    console.error('STK Push Error:', err);
    return fail(res, 500, 'Error processing STK Push: ' + err.message);
  }
});

// POST /api/mpesa/callback
router.post('/callback', async (req, res) => {
  try {
    const { Body } = req.body || {};
    if (!Body || !Body.stkCallback) {
      console.log('M-Pesa Callback missing stkCallback body:', req.body);
      return res.status(200).send('OK'); // Always respond 200 to Safaricom
    }

    const callbackData = Body.stkCallback;
    const checkoutRequestId = callbackData.CheckoutRequestID;
    const resultCode = callbackData.ResultCode;

    const transaction = await MpesaTransaction.findOne({
      where: { checkout_request_id: checkoutRequestId }
    });

    if (!transaction) {
      console.error('No matching Mpesa transaction found for checkoutRequestId:', checkoutRequestId);
      return res.status(200).send('OK');
    }

    if (resultCode === 0) {
      // Success! Update status to paid_pending_approval
      transaction.status = 'paid_pending_approval';
      await transaction.save();
      console.log(`M-Pesa Transaction ${transaction.id} paid. Pending Admin approval.`);
    } else {
      transaction.status = 'failed';
      await transaction.save();
      console.log(`M-Pesa Transaction ${transaction.id} failed with code ${resultCode}: ${callbackData.ResultDesc}`);
    }

    return res.status(200).send('OK');
  } catch (err) {
    console.error('Mpesa Callback handling error:', err);
    return res.status(200).send('OK');
  }
});

// GET /api/mpesa/callback (For testing / verification)
router.get('/callback', (req, res) => {
  return res.status(200).json({ ok: true, message: 'Callback endpoint is active' });
});

// GET /api/mpesa/transactions (Admin only)
router.get('/transactions', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    // Load with Member info
    const transactions = await MpesaTransaction.findAll({
      where: { admin_id: admin.id },
      include: [{ model: Member, as: 'member', attributes: ['id', 'full_name', 'phone'] }],
      order: [['created_at', 'DESC']]
    });

    return ok(res, transactions);
  } catch (err) {
    return fail(res, 500, err.message);
  }
});

// GET /api/mpesa/transactions/member/:id (Member specific)
router.get('/transactions/member/:id', async (req, res) => {
  try {
    const member = getMemberFromRequest(req);
    if (!member) return fail(res, 401, 'Member authentication required');

    const memberId = Number(req.params.id);
    if (member.id !== memberId) {
      return fail(res, 403, 'Unauthorized access to transaction details');
    }

    const transactions = await MpesaTransaction.findAll({
      where: { member_id: memberId },
      order: [['created_at', 'DESC']]
    });

    return ok(res, transactions);
  } catch (err) {
    return fail(res, 500, err.message);
  }
});

// POST /api/mpesa/approve (Admin only)
router.post('/approve', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.body;
    const tx = await MpesaTransaction.findByPk(id);

    if (!tx) return fail(res, 404, 'Transaction not found');
    if (tx.status !== 'paid_pending_approval') {
      return fail(res, 400, `Cannot approve transaction in status: ${tx.status}`);
    }

    // Determine target based on purpose
    const isRepayment = tx.purpose && tx.purpose.toLowerCase().includes('repayment');
    
    if (isRepayment) {
      // Find active loan for member to apply repayment
      // We'll create a Repayment record
      await Repayment.create({
        member_id: tx.member_id,
        amount: tx.amount,
        payment_method: 'M-Pesa',
        payment_date: new Date(),
        admin_id: admin.id,
        notes: `Auto-approved M-Pesa transaction ID ${tx.id}`
      });
    } else {
      // Create Contribution
      await Contribution.create({
        member_id: tx.member_id,
        amount: tx.amount,
        type: tx.purpose || 'M-Pesa Contribution',
        date: new Date(),
        admin_id: admin.id,
        payment_method: 'M-Pesa'
      });
    }

    tx.status = 'approved';
    await tx.save();

    return ok(res, { approved: true });
  } catch (err) {
    console.error('Approval Error:', err);
    return fail(res, 500, err.message);
  }
});

// POST /api/mpesa/deny (Admin only)
router.post('/deny', async (req, res) => {
  try {
    const admin = requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.body;
    const tx = await MpesaTransaction.findByPk(id);

    if (!tx) return fail(res, 404, 'Transaction not found');
    tx.status = 'denied';
    await tx.save();

    return ok(res, { denied: true });
  } catch (err) {
    return fail(res, 500, err.message);
  }
});

module.exports = router;
