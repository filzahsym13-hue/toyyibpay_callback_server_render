// index.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const axios = require('axios');
const qs = require('querystring');

const app = express();

// ----- Config -----
const PORT = process.env.PORT || 3000;
const TOYYIBPAY_SECRET_KEY = process.env.TOYYIBPAY_SECRET_KEY || '';
const TOYYIBPAY_CATEGORY_CODE = process.env.TOYYIBPAY_CATEGORY_CODE || '';
const TOYYIBPAY_BASE_URL =
  process.env.TOYYIBPAY_BASE_URL || 'https://toyyibpay.com/index.php/api/';

const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

// ----- Middleware -----
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());               // JSON bodies
app.use(express.urlencoded({ extended: true })); // form bodies
app.use(morgan('tiny'));

// ----- Health -----
app.get('/health', (req, res) => res.status(200).send('ok'));

// ----- Create Bill (wrapper) -----
// Accept a minimal payload and pass-through to ToyyibPay.
// You can send extra ToyyibPay fields in req.body; we forward them.
app.post('/create-bill', async (req, res) => {
  try {
    if (!TOYYIBPAY_SECRET_KEY || !TOYYIBPAY_CATEGORY_CODE) {
      return res.status(500).json({ error: 'Server payment keys not set' });
    }

    // Required minimum fields (tweak as needed for your flow)
    const {
      billName = 'ATSporty Payment',
      billDescription = 'Order payment',
      billAmount,         // e.g. "10.00" (RM)
      billTo,             // payer name
      billEmail,          // payer email
      billReturnUrl,      // your frontend thank-you page
      billCallbackUrl,    // your backend callback endpoint (/callback)
      ...rest             // any additional ToyyibPay fields (optional)
    } = req.body || {};

    if (!billAmount || !billEmail) {
      return res.status(400).json({ error: 'billAmount and billEmail are required' });
    }

    // ToyyibPay expects application/x-www-form-urlencoded
    const payload = {
      userSecretKey: TOYYIBPAY_SECRET_KEY,
      categoryCode: TOYYIBPAY_CATEGORY_CODE,
      billName,
      billDescription,
      billAmount,        // ToyyibPay accepts string (e.g. "10.00")
      billTo,
      billEmail,
      billReturnUrl,
      billCallbackUrl,
      ...rest
    };

    const url = TOYYIBPAY_BASE_URL.replace(/\/+$/, '') + '/createBill';

    const { data } = await axios.post(url, qs.stringify(payload), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000
    });

    // ToyyibPay returns an array with billCode on success
    return res.status(200).json({ ok: true, gateway: data });
  } catch (err) {
    console.error('create-bill error:', err?.response?.data || err.message);
    return res.status(500).json({
      ok: false,
      error: err?.response?.data || err.message
    });
  }
});

// ----- Callback (ToyyibPay → your server) -----
// Configure ToyyibPay "Callback URL" to point here.
app.post('/callback', async (req, res) => {
  try {
    // ToyyibPay posts payment status fields here.
    // Example fields: status, billcode, order_id, amount, etc.
    // Persist to DB or verify signature if you implement one.
    console.log('ToyyibPay callback:', req.body);

    // TODO: upsert payment status to your DB
    // await savePaymentStatus(req.body);

    res.status(200).send('OK');
  } catch (err) {
    console.error('callback error:', err.message);
    res.status(500).send('ERR');
  }
});

// ----- Root (optional) -----
app.get('/', (req, res) => {
  res.type('json').send({ name: 'payment-api', status: 'running' });
});

// ----- Start -----
app.listen(PORT, () => {
  console.log(`payment-api listening on ${PORT}`);
});
