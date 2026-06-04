# Homes API

Homes supports rentals, short stay homes, and properties for sale.

## Public Catalog

- `GET /api/homes/listings`
  - Query: `kind=rent|stay|sale`, `where`, `minPrice`, `maxPrice`, `bedrooms`, `propertyType`, `guests`, `page`, `pageSize`
  - Returns published listings only.
- `GET /api/homes/listings/:id`
  - `:id` can be a numeric id, `documentId`, or `slug`.
  - Owner phone is hidden unless the requester has an active contact unlock.

## Listings

- `GET /api/homes/me/listings`
  - Auth required. Lists the signed-in user's listings.
- `POST /api/homes/listings`
  - Auth required. Creates a pending listing draft.
  - Body fields: `title`, `kind`, `location`, `priceUGX`, `propertyType`, `description`, `ownerRole`, `bedrooms`, `bathrooms`, `guests`, `amenities`, `sections`, `rules`.
- `PUT /api/homes/listings/:id`
  - Auth required. Owner or admin only.
  - Owners can update listing details and `availabilityStatus`; admins can also publish/reject/archive via `status`.

## KYC

- `POST /api/homes/kyc`
  - Auth required. Upserts KYC for `landlord`, `broker`, or `host`.
  - Body: `role`, `idNumber`, `businessName`, `location`, `documentImages`.
- `GET /api/homes/kyc/me`
  - Auth required. Returns the user's KYC submissions.
- `PUT /api/homes/kyc/:id/review`
  - Admin only. Body: `status=approved|rejected|pending`, `notes`.

## Payments And Guest Actions

- `POST /api/homes/listings/:id/unlock-contact`
  - Auth required. Creates a Homes contact unlock payment.
  - Body: `paymentPhone`.
- `POST /api/homes/listings/:id/bookings`
  - Auth required. Short stay homes only.
  - Body: `checkIn`, `checkOut`, `guests`, `paymentPhone`, `specialRequests`.
- `GET /api/homes/payments/check-status?transactionId=...`
  - Auth required. Polls contact unlock or booking payment status.
- `GET /api/homes/bookings/me`
  - Auth required. Returns bookings where the user is guest or host.
- `POST /api/homes/listings/:id/save`
  - Auth required. Toggles saved state for a listing.
- `GET /api/homes/saves/me`
  - Auth required. Returns saved listings.

Homes payments use the existing Pesapal, DGateway, and Yo webhook flows. Merchant references begin with `HCU_` for contact unlocks and `HBOOK_` for bookings.