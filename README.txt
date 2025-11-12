ToyyibPay Callback Server (Render + Android Emulator)

Overview
This is a minimal Node.js HTTP server that creates ToyyibPay bills and handles callback/return endpoints. It is designed to run on Render or locally, and supports Android Studio emulator via host alias 10.0.2.2.

Endpoints
- POST /payment/create
  Body (JSON):
  {
    "amount": 12.34,
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "0123456789",
    "orderId": "ORDER123",
    "description": "Top up",
    "returnUrl": "optional override",
    "callbackUrl": "optional override"
  }
  Response:
  {
    "paymentUrl": "...",
    "billCode": "...",
    "orderId": "ORDER123",
    "callbackUrl": "...",
    "returnUrl": "...",
    "environment": "sandbox|production"
  }

- GET/POST /payment/callback
  Receives ToyyibPay server-to-server notifications. Responds with "OK".

- GET /payment/return
  User is redirected here after payment; displays simple status page.

Setup
1) Create a .env file next to index.js with at least:
   TOYYIBPAY_SECRET_KEY=your_secret_key
   TOYYIBPAY_CATEGORY_CODE=your_category_code
   TOYYIBPAY_SANDBOX=true
   PORT=8080
   BASE_URL=http://localhost:8080
   TOYYIBPAY_CALLBACK_URL=http://10.0.2.2:8080/payment/callback
   TOYYIBPAY_RETURN_URL=http://10.0.2.2:8080/payment/return

2) Install dependencies:
   npm install

3) Run:
   npm start

Android Emulator Notes
- Access the host server from emulator using http://10.0.2.2:8080
- Ensure your firewall allows inbound connections to the selected port.

Security
- If you set WEBHOOK_SIGNATURE_SECRET, the server will attempt simple HMAC verification for callbacks using order_id as message.

License
- MIT (see LICENSE).


