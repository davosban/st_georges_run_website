# St. George’s Sunrise Run & Walk — registration website

A mobile-friendly event site with real registration storage and **two possible MoMo workflows**:

1. **Direct MoMo transfer** (simplest first-launch option): The participant registers, sees the official number and account name, transfers the exact amount using their own MoMo service, and enters their transaction reference. The system marks the payment **Awaiting verification** until your organiser checks it against the official statement and manually confirms it in `/admin`. **The website cannot automatically detect transfers to a personal MoMo number.**
2. **Paystack Mobile Money checkout** (optional): The server creates a Paystack-hosted Mobile Money checkout. Paystack collects payment and settles into the approved merchant account. The server verifies the payment amount, currency and reference through the webhook or API before confirming registration. This is *not* a direct transfer to the public MoMo number in option 1.

The ZIP includes backend, styled frontend, admin dashboard and source files. **It is not deployed yet.** No live collection is enabled without a correctly configured wallet/merchant account.

## Included features

- First-edition event landing page; mobile-friendly and designed for St. George’s Doboro edition.
- **One ticket type: General admission GH₵80 per participant**, whether the participant selects the 3 km walk or 5 km run. No early bird, premium, or group tier.
- **Confirmed date: Friday, 4 December 2026**. Route choice of 3 km walk or 5 km run, participant details, emergency contact and guardian approval for under-18s.
- New **`/waiver` medical waiver & health declaration** with advice on health readiness, route risks, safety rules, medical support and privacy. Registration requires a distinct health declaration and first-aid acknowledgement. The database stores the version/time accepted, but no health diagnoses. Photographic permission is separately optional.
- Backend-generated registration codes and secure, unguessable receipt URLs.
- Pending/paid/rejected payment statuses and manual verification dashboard at `/admin`.
- CSV download with participants and payment status.
- Optional Paystack checkout with server-side amount verification and signature-checked webhook.
- No password, PIN, card or MoMo OTP collection.

## Requirements

- Node.js **22.13+** or newer (uses Node’s built-in SQLite module).
- HTTPS and a persistent server/disk for a public event. **Static website hosting alone is insufficient.**
- To use automatic checkout: an approved Paystack Ghana merchant account and live secret key, plus an internet-reachable domain and callback URL.

## Set up locally

1. Copy `.env.example` to `.env`.
2. The confirmed date and GH₵80 fee are prefilled. Enter the verified official MoMo number and *registered account name*. Enter a strong `ADMIN_PASSWORD` and an independent random `SESSION_SECRET` of at least 32 bytes. Confirm the remaining event details before opening.
3. `npm start` (no npm packages are needed). Open `http://localhost:3000`.
4. The application is **preview only** unless a wallet or gateway is configured. For local end-to-end testing *without real payments*, you may set `TEST_MODE=true` in `.env`, use fictional participant details, then reset to `false` before public launch. Do not publish a TEST_MODE site.
5. Open `http://localhost:3000/admin` to verify submitted transaction IDs against the MoMo account's actual transaction history.

`MOMO_NUMBER` and `MOMO_NAME` are required together for direct transfer. Do not place payment credentials into the HTML or frontend JavaScript.

## Recommended public launch

- Host on a service that can run **Node.js persistently and provide a persistent volume**, for example a suitable server or paid web app host. Set `DATA_DIR` to a persistent filesystem path. SQLite is not appropriate on ephemeral serverless storage.
- Configure HTTPS, a real domain, monitoring, automated database backups, and access to the admin password only for authorised organisers. Set the `PUBLIC_BASE_URL` to the deployed HTTPS website URL.
- Test registration, payment of a minimal approved amount in a proper test environment, refunds/cancellations, webhook replay handling, manual transfers, duplicate references, downtime and admin exports before publishing.
- Publish the approved event date, exact route, terms, cancellation/refund policy, final medical/safety arrangements and event contact details. **Have the health waiver reviewed by a Ghana-qualified legal professional and the appointed medical lead, then set `WAIVER_VERSION` to the final approved version.** The wording in this package is an organiser draft, not legal advice or medical clearance.
- Do not publicly deploy the sample environment file or the `data` directory. Back up `registrations.sqlite` securely.
- For Paystack, add the webhook URL `https://YOUR-DOMAIN/api/paystack/webhook` in the merchant dashboard. Use live credentials only after merchant compliance approval and test mode validation.
- Update your privacy notice to identify the responsible organiser, retention period, contact point and applicable Ghana data protection obligations. The form collects an emergency contact, parent/guardian information for minors, and consent timestamps: protect it, limit access to authorised staff, and share it only for necessary safety purposes. Obtain separate photo and marketing permissions, as the page does.

### Important privacy / security limitations

This is a capable **starter website**, not a certified payment product. It must be tested and security-reviewed before taking the public's personal data and money. The organiser has to verify all manual MoMo transfers; a user-submitted transaction ID is not evidence of payment. Do not tell participants they are confirmed merely because they returned from a payment website.

All admin communications should happen over HTTPS. The included simple admin password is acceptable for a small, tightly controlled first edition only; if a large staff team needs individual logins, use a proper identity provider. A production hosting plan must include backups and appropriate data handling.

## Customise branding

- `public/style.css` controls colour, type and layout.
- `public/index.html` controls event content and sections.
- `public/favicon.svg` is a simple temporary SG monogram — replace with the approved official logo.
- Server `EVENT_DATE_DISPLAY`, `EVENT_LOCATION`, prices and payment details are editable in `.env`.

## Admin access

Go to `/admin` and enter your `ADMIN_PASSWORD`. Search/filter can be done by exporting the CSV; the app lists up to the latest 5,000 registrations in the dashboard.

## How auto-payments are verified

- Paystack initialisation uses the **server-secret** key and the agreed ticket price in pesewas.
- Webhook authenticity is verified via HMAC SHA-512.
- Status is set to `paid` only if payment reference, `GHS` currency and charged amount match the registration.
- On returning from checkout, the receipt screen also checks the transaction directly with Paystack; **returning to the site is not sufficient proof of payment**.

## Confirmed pricing and branding status

The organiser confirmed one GH₵80 general admission ticket for Friday, 4 December 2026. The default server-side registration endpoint rejects legacy early, premium, standard and group tiers. Payment account information is **not yet confirmed**, so no live registration is possible with the sample environment. The current green/cream/champagne colours and SG monogram are a **temporary presentation concept**, not a verified official Instagram logo or brand palette. Replace `public/favicon.svg`, the temporary `SG` mark in `nav()` in `server.js`, and CSS variables once an approved logo/profile image or branding guide is supplied. Do not claim the temporary monogram is the resort’s official logo.
