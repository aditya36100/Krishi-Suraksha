const express = require('express');
const router = express.Router();
const {
  createListing,
  getMyListings,
  getActiveListings,
  getListingById,
  updateListing,
  deleteListing
} = require('../controllers/listingController');
const { requireAuth, requireRole } = require('../middleware/auth');

// 1. GET /api/listings: Public route to browse active listings with filters & pagination
router.get('/', getActiveListings);

// 2. GET /api/listings/mine: Farmer-only route for own listings (Must be defined BEFORE /:id to prevent route shadowing)
router.get('/mine', requireAuth, requireRole('FARMER'), getMyListings);

// 3. GET /api/listings/:id: Public route for single listing details (Inactive visible only to creator)
router.get('/:id', getListingById);

// 4. POST /api/listings: Farmer-only route to create a crop listing
router.post('/', requireAuth, requireRole('FARMER'), createListing);

// 5. PATCH /api/listings/:id: Farmer-only route to update own listing (Atomic quantity adjustment)
router.patch('/:id', requireAuth, requireRole('FARMER'), updateListing);

// 6. DELETE /api/listings/:id: Farmer-only route to soft-delete own listing (isActive = false)
router.delete('/:id', requireAuth, requireRole('FARMER'), deleteListing);

module.exports = router;
