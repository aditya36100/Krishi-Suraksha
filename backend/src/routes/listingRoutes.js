const express = require('express');
const router = express.Router();
const {
  createListing,
  getMyListings,
  getActiveListings,
  getListingById,
  updateListing
} = require('../controllers/listingController');
const { requireAuth, requireRole } = require('../middleware/auth');

// Public route: Browse active listings with filters & pagination
router.get('/', getActiveListings);

// Farmer only: View farmer's own listings (Must be defined before /:id)
router.get('/mine', requireAuth, requireRole('FARMER'), getMyListings);

// Public / Owner: Single listing details (Active listings public; inactive restricted to creator)
router.get('/:id', getListingById);

// Farmer only: Create a new crop listing
router.post('/', requireAuth, requireRole('FARMER'), createListing);

// Farmer only: Update own crop listing or toggle active status
router.put('/:id', requireAuth, requireRole('FARMER'), updateListing);

module.exports = router;
