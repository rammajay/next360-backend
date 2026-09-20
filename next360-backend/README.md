# Next360 Backend

Shared Node/Express/TypeScript API for the Buyer App, Seller Dashboard, and Admin Panel.

## Setup
```
npm install
npm run seed   # creates admin, 2 approved sellers, 4 sample products
npm run dev    # starts on http://localhost:4000
```

## Test accounts (OTP is always 123456)
- Admin:  9999999999
- Seller: 9000000001 / 9000000002 (pre-approved, ready to list products)
- Buyer:  9111111111

## Key endpoints
- POST /auth/login, /auth/verify-otp
- GET  /products  (buyer discovery — organic only shows if approved)
- POST /products  (seller create — multipart, field `certificate` for organic)
- GET  /products/admin/pending, POST /products/admin/:id/approve|reject
- POST /orders, GET /orders, PATCH /orders/:id/status
- GET  /sellers/earnings
- Full route list in src/routes/*.ts

## Notes on scope (agreed cuts)
- OTP is simulated (no SMS provider) — see src/routes/auth.ts
- Payment is mocked — /orders just records the order, no gateway call
- Certificate/KYC files stored on local disk under /uploads, not S3
- Disputes are basic list + resolve, not a full ticketing workflow
- Commission fixed at 15% (PRD gives a 10-20% range, not an exact figure)
