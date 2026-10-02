const express = require('express');
const router = express.Router();
const {
  createOrder,
  getBuyerOrders,
  getIncomingOrders,
  getOrderById,
  updateOrderStatus,
  createRazorpayOrder,
  verifyPayment
} = require('../controllers/orderController');
const { requireAuth, requireRole } = require('../middleware/auth');

// 1. GET /api/orders/mine: Buyer-only route for own orders (Must be defined BEFORE /:id)
router.get('/mine', requireAuth, requireRole('BUYER'), getBuyerOrders);

// 2. GET /api/orders/incoming: Farmer-only route for incoming orders on own listings (Must be defined BEFORE /:id)
router.get('/incoming', requireAuth, requireRole('FARMER'), getIncomingOrders);

// 3. GET /api/orders/:id: Authenticated route for single order details (Controller enforces buyer/farmer/admin ownership)
router.get('/:id', requireAuth, getOrderById);

// 4. POST /api/orders: Buyer-only route to create advance order with atomic inventory decrement
router.post('/', requireAuth, requireRole('BUYER'), createOrder);

// 5. PATCH /api/orders/:id/status: Status transition route (Controller enforces state machine and ownership)
router.patch('/:id/status', requireAuth, requireRole('FARMER', 'BUYER'), updateOrderStatus);

// 6. POST /api/orders/:id/pay: Buyer-only route to create Razorpay payment order
router.post('/:id/pay', requireAuth, requireRole('BUYER'), createRazorpayOrder);

// 7. POST /api/orders/:id/verify-payment: Buyer-only route to cryptographically verify payment signature
router.post('/:id/verify-payment', requireAuth, requireRole('BUYER'), verifyPayment);

module.exports = router;
