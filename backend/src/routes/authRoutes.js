const express = require('express');
const router = express.Router();
const {
  sendFarmerOtp,
  verifyFarmerOtp,
  registerBuyer,
  loginWithPassword,
  getMe
} = require('../controllers/authController');
const { requireAuth, requireRole } = require('../middleware/auth');

// Public farmer phone/OTP routes
router.post('/farmer/send-otp', sendFarmerOtp);
router.post('/farmer/verify-otp', verifyFarmerOtp);

// Public buyer registration and email/password login
router.post('/buyer/register', registerBuyer);
router.post('/login', loginWithPassword);

// Protected routes (Requires Bearer token)
router.get('/me', requireAuth, getMe);

// Admin-only test route to verify role-based middleware
router.get('/admin/verify-access', requireAuth, requireRole('ADMIN'), (req, res) => {
  res.json({
    success: true,
    message: 'Welcome Admin: Role-based authorization verified successfully',
    adminUser: req.user
  });
});

module.exports = router;
