// ToyyibPay Callback Server for Render / Local (Android emulator-friendly)
// Zero-dependency HTTP server (no Express) to maximize portability.
// Reads configuration from environment variables. See .env scaffold we provided.

/* eslint-disable no-console */
const http = require('http');
const { URL } = require('url');
const crypto = require('crypto');

// Load dotenv if available (safe-optional)
try {
  // eslint-disable-next-line global-require
  require('dotenv').config();
} catch (_) {
  // dotenv not installed; continue
}

// Polyfill fetch if not available (Node < 18)
async function ensureFetch() {
  if (typeof fetch === 'function') return fetch;
  const mod = await import('node-fetch');
  return mod.default;
}

function getEnv(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

const NODE_ENV = getEnv('NODE_ENV', 'development');
const PORT = parseInt(getEnv('PORT', '8080'), 10);
const RENDER_EXTERNAL_URL = getEnv('RENDER_EXTERNAL_URL', '');
const BASE_URL = RENDER_EXTERNAL_URL || getEnv('BASE_URL', `http://localhost:8080`);
const ANDROID_EMULATOR_HOST = getEnv('ANDROID_EMULATOR_HOST', '10.0.2.2');

const TOYYIBPAY_SANDBOX = String(getEnv('TOYYIBPAY_SANDBOX', 'true')).toLowerCase() === 'true';
const TOYYIBPAY_CATEGORY_CODE = getEnv('TOYYIBPAY_CATEGORY_CODE', '');
const TOYYIBPAY_SECRET_KEY = getEnv('TOYYIBPAY_SECRET_KEY', '');
const TOYYIBPAY_COLLECTION_ID = getEnv('TOYYIBPAY_COLLECTION_ID', '');
const TOYYIBPAY_MERCHANT_CODE = getEnv('TOYYIBPAY_MERCHANT_CODE', '');

const TOYYIBPAY_CALLBACK_URL = getEnv(
  'TOYYIBPAY_CALLBACK_URL',
  `http://10.0.2.2:8080/payment/callback`,
);
const TOYYIBPAY_RETURN_URL = getEnv(
  'TOYYIBPAY_RETURN_URL',
  `http://10.0.2.2:8080/payment/return`,
);

const WEBHOOK_SIGNATURE_SECRET = getEnv('WEBHOOK_SIGNATURE_SECRET', '');
const LOG_LEVEL = getEnv('LOG_LEVEL', 'info');

function logInfo(...args) {
  if (['info', 'debug', 'trace'].includes(LOG_LEVEL)) console.log('[info]', ...args);
}
function logDebug(...args) {
  if (['debug', 'trace'].includes(LOG_LEVEL)) console.log('[debug]', ...args);
}
function logError(...args) {
  console.error('[error]', ...args);
}

function toyyibApiBase() {
  return TOYYIBPAY_SANDBOX ? 'https://dev.toyyibpay.com' : 'https://toyyibpay.com';
}

function paymentPageBase() {
  return TOYYIBPAY_SANDBOX ? 'https://dev.toyyibpay.com/' : 'https://toyyibpay.com/';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      resolve(raw);
    });
    req.on('error', reject);
  });
}

function parseBodyByContentType(req, raw) {
  const contentType = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!raw) return {};
  if (contentType === 'application/json') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (contentType === 'application/x-www-form-urlencoded') {
    const params = new URLSearchParams(raw);
    const out = {};
    params.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  // Attempt JSON parse as fallback; else text
  try {
    return JSON.parse(raw);
  } catch {
    return { _raw: raw };
  }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function notFound(res) {
  sendJson(res, 404, { error: 'Not found' });
}

function badRequest(res, message, details) {
  sendJson(res, 400, { error: message, details });
}

function ok(res, payload) {
  sendJson(res, 200, payload);
}

function centsFromAmount(amount) {
  // ToyyibPay expects billAmount in cents (integer).
  const n = Number(amount);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100);
}

function hmacSha256(key, message) {
  return crypto.createHmac('sha256', key).update(message).digest('hex');
}

async function handleCreatePayment(req, res) {
  if (req.method !== 'POST') return badRequest(res, 'Use POST for /payment/create');
  const raw = await readBody(req);
  const body = parseBodyByContentType(req, raw);
  logDebug('create body:', body);

  const {
    amount,
    name,
    email,
    phone,
    orderId,
    description,
    returnUrl, // optional override
    callbackUrl, // optional override
  } = body;

  if (!TOYYIBPAY_SECRET_KEY || !TOYYIBPAY_CATEGORY_CODE) {
    return badRequest(res, 'ToyyibPay credentials missing', {
      need: ['TOYYIBPAY_SECRET_KEY', 'TOYYIBPAY_CATEGORY_CODE'],
    });
  }

  if (!amount || !name || !orderId || !description) {
    return badRequest(res, 'Missing required fields', {
      required: ['amount', 'name', 'orderId', 'description'],
    });
  }

  const billAmount = centsFromAmount(amount);
  if (billAmount === null) {
    return badRequest(res, 'Invalid amount', { amount });
  }

  const billReturnUrl = returnUrl || TOYYIBPAY_RETURN_URL || `${BASE_URL}/payment/return`;
  const billCallbackUrl = callbackUrl || TOYYIBPAY_CALLBACK_URL || `${BASE_URL}/payment/callback`;

  const params = new URLSearchParams();
  params.set('userSecretKey', TOYYIBPAY_SECRET_KEY);
  params.set('categoryCode', TOYYIBPAY_CATEGORY_CODE);
  params.set('billName', String(description).slice(0, 100));
  params.set('billDescription', String(description).slice(0, 200));
  params.set('billAmount', String(billAmount));
  params.set('billReturnUrl', billReturnUrl);
  params.set('billCallbackUrl', billCallbackUrl);
  params.set('billExternalReferenceNo', String(orderId));
  params.set('billTo', String(name).slice(0, 100));
  if (email) params.set('billEmail', String(email));
  if (phone) params.set('billPhone', String(phone));
  if (TOYYIBPAY_COLLECTION_ID) params.set('collectionId', TOYYIBPAY_COLLECTION_ID);
  if (TOYYIBPAY_MERCHANT_CODE) params.set('merchantCode', TOYYIBPAY_MERCHANT_CODE);
  // Optional: Immediate payment
  params.set('billPaymentChannel', '1'); // 1: FPX & Card

  try {
    const $fetch = await ensureFetch();
    const resp = await $fetch(`${toyyibApiBase()}/index.php/api/createBill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const text = await resp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    logDebug('Toyyib createBill response:', data);

    if (!resp.ok) {
      return sendJson(res, resp.status, { error: 'ToyyibPay error', data });
    }

    // Toyyib typically returns an array with BillCode and BillURL
    let billCode;
    let billUrl;
    if (Array.isArray(data) && data.length > 0) {
      billCode = data[0]?.BillCode || data[0]?.billCode || data[0]?.BillCode?.toString();
      billUrl = data[0]?.BillURL || data[0]?.billUrl;
    }
    if (!billUrl && billCode) {
      billUrl = `${paymentPageBase()}${billCode}`;
    }
    if (!billUrl) {
      return sendJson(res, 502, { error: 'Unable to parse ToyyibPay response', data });
    }

    return ok(res, {
      paymentUrl: billUrl,
      billCode: billCode || null,
      orderId,
      callbackUrl: billCallbackUrl,
      returnUrl: billReturnUrl,
      environment: TOYYIBPAY_SANDBOX ? 'sandbox' : 'production',
    });
  } catch (err) {
    logError('createBill failed:', err);
    return sendJson(res, 500, { error: 'Request failed', message: String(err?.message || err) });
  }
}

async function handleCallback(req, res, urlObj) {
  // ToyyibPay may call via GET or POST depending on settings. Accept both.
  const raw = await readBody(req);
  const content = parseBodyByContentType(req, raw);
  const payload = { ...Object.fromEntries(urlObj.searchParams.entries()), ...content };

  // Optional signature verification if you configured one on your side.
  let signatureValid = null;
  if (WEBHOOK_SIGNATURE_SECRET && payload.signature && payload.order_id) {
    // Example scheme: HMAC_SHA256(secret, order_id)
    const expected = hmacSha256(WEBHOOK_SIGNATURE_SECRET, String(payload.order_id));
    signatureValid = expected === String(payload.signature);
  }

  logInfo('Callback received:', {
    query: Object.fromEntries(urlObj.searchParams.entries()),
    body: content,
    signatureValid,
  });

  // Respond 200 plain OK (ToyyibPay expects OK)
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('OK');
}

async function handleReturn(req, res, urlObj) {
  const params = Object.fromEntries(urlObj.searchParams.entries());
  logInfo('Return received:', params);
  const success = params.status_id === '1' || params.status === '1';
  const html = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Payment ${success ? 'Success' : 'Status'}</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 24px; }
      .card { max-width: 640px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px; }
      .ok { color: #065f46; background: #d1fae5; padding: 8px 12px; border-radius: 8px; display: inline-block; }
      .bad { color: #7f1d1d; background: #fee2e2; padding: 8px 12px; border-radius: 8px; display: inline-block; }
      code, pre { background: #f3f4f6; padding: 12px; display: block; border-radius: 8px; overflow-x: auto; }
      a.btn { display: inline-block; margin-top: 12px; padding: 10px 14px; background: #111827; color: white; text-decoration: none; border-radius: 8px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>ToyyibPay Payment ${success ? 'Successful' : 'Result'}</h1>
      <div class="${success ? 'ok' : 'bad'}">
        ${success ? 'Your payment was successful.' : 'Payment status received.'}
      </div>
      <h3>Details</h3>
      <pre>${escapeHtml(JSON.stringify(params, null, 2))}</pre>
      <a class="btn" href="/">Back to home</a>
    </div>
  </body>
</html>`;
  sendHtml(res, 200, html);
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function handleHome(_req, res) {
  const html = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>ToyyibPay Callback Server</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 24px; }
      .card { max-width: 720px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px; }
      code, pre { background: #f3f4f6; padding: 12px; display: block; border-radius: 8px; overflow-x: auto; }
      .meta { color: #6b7280; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>ToyyibPay Callback Server</h1>
      <p class="meta">Env: ${escapeHtml(NODE_ENV)} • Base URL: ${escapeHtml(BASE_URL)}</p>
      <h3>Endpoints</h3>
      <ul>
        <li>POST <code>/payment/create</code> → { amount, name, email?, phone?, orderId, description }</li>
        <li>GET/POST <code>/payment/callback</code> → ToyyibPay server-to-server callback</li>
        <li>GET <code>/payment/return</code> → User redirection after payment</li>
      </ul>
      <h3>Android Emulator</h3>
      <p>Use <code>${escapeHtml(`http://10.0.2.2:8080`)}</code> from emulator to reach this server on your host.</p>
      <h3>Create Bill Example (curl)</h3>
      <pre>curl -X POST ${escapeHtml(`${BASE_URL}/payment/create`)} \\
  -H \"Content-Type: application/json\" \\
  -d '{\"amount\": 12.34, \"name\": \"John Doe\", \"email\": \"john@example.com\", \"phone\": \"0123456789\", \"orderId\": \"ORDER123\", \"description\": \"Top up\"}'</pre>
    </div>
  </body>
</html>`;
  sendHtml(res, 200, html);
}

const server = http.createServer(async (req, res) => {
  try {
    const urlObj = new URL(req.url, 'http://localhost');
    const { pathname } = urlObj;

    if (req.method === 'GET' && pathname === '/') return handleHome(req, res);
    if (pathname === '/payment/create') return handleCreatePayment(req, res);
    if (pathname === '/payment/callback') return handleCallback(req, res, urlObj);
    if (pathname === '/payment/return') return handleReturn(req, res, urlObj);

    return notFound(res);
  } catch (err) {
    logError('Unhandled server error:', err);
    return sendJson(res, 500, { error: 'Internal error', message: String(err?.message || err) });
  }
});

server.listen(PORT, () => {
  logInfo(
    `ToyyibPay callback server running on ${BASE_URL} (env=${NODE_ENV}, sandbox=${TOYYIBPAY_SANDBOX})`,
  );
});


