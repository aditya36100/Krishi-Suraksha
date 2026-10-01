const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');

// In-memory OTP storage: phoneNumber -> { otp, expiresAt, attempts }
const otpStore = new Map();

const MAX_OTP_ATTEMPTS = 5;
const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Helper: Generate JWT token containing user id and role
 */
const generateToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      phoneNumber: user.phoneNumber,
      email: user.email,
      name: user.name
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

/**
 * Helper: Strip sensitive fields like passwordHash from user object
 */
const sanitizeUser = (user) => {
  if (!user) return null;
  const { passwordHash, ...safeUser } = user;
  return safeUser;
};

/**
 * POST /api/auth/farmer/send-otp
 * Generates and logs a 6-digit mock OTP for farmer phone verification.
 * Blocks numbers registered to other roles (e.g. BUYER or ADMIN).
 */
const sendFarmerOtp = async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber || typeof phoneNumber !== 'string' || phoneNumber.trim().length < 10) {
      return res.status(400).json({
        success: false,
        error: 'A valid 10+ digit Indian phone number is required (e.g. +919876543210 or 9876543210)'
      });
    }

    const formattedPhone = phoneNumber.startsWith('+91')
      ? phoneNumber.trim()
      : `+91${phoneNumber.replace(/^0+/, '').trim()}`;

    // Security check: Check if an account already exists with this phone number
    const existingUser = await prisma.user.findUnique({
      where: { phoneNumber: formattedPhone }
    });

    if (existingUser && existingUser.role !== 'FARMER') {
      return res.status(403).json({
        success: false,
        error: 'This phone number is not registered as a farmer'
      });
    }

    // Generate random 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + OTP_EXPIRY_MS;

    otpStore.set(formattedPhone, {
      otp,
      expiresAt,
      attempts: 0
    });

    console.log(`\n========================================`);
    console.log(`📲 [MOCK SMS GATEWAY] Farmer Login OTP`);
    console.log(`To Phone : ${formattedPhone}`);
    console.log(`Your OTP : ${otp}`);
    console.log(`Expires  : In 5 minutes`);
    console.log(`========================================\n`);

    return res.status(200).json({
      success: true,
      message: `OTP sent successfully to ${formattedPhone}. (Check backend terminal for OTP in dev mode)`,
      mockOtp: process.env.NODE_ENV !== 'production' ? otp : undefined,
      expiresInSeconds: 300
    });
  } catch (error) {
    console.error('Error in sendFarmerOtp:', error);
    return res.status(500).json({ success: false, error: 'Internal server error while sending OTP' });
  }
};

/**
 * POST /api/auth/farmer/verify-otp
 * Verifies OTP, checks farmer role constraint, registers farmer if new, or logs in if existing.
 */
const verifyFarmerOtp = async (req, res) => {
  try {
    const { phoneNumber, otp, name, state, district, village, upiId, preferredLang } = req.body;

    if (!phoneNumber || !otp) {
      return res.status(400).json({
        success: false,
        error: 'Both phoneNumber and otp are required'
      });
    }

    const formattedPhone = phoneNumber.startsWith('+91')
      ? phoneNumber.trim()
      : `+91${phoneNumber.replace(/^0+/, '').trim()}`;

    const record = otpStore.get(formattedPhone);

    if (!record) {
      return res.status(400).json({
        success: false,
        error: 'No OTP requested for this phone number or OTP has expired. Please request a new OTP.'
      });
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(formattedPhone);
      return res.status(400).json({
        success: false,
        error: 'OTP has expired (validity is 5 minutes). Please request a new one.'
      });
    }

    if (record.attempts >= MAX_OTP_ATTEMPTS) {
      otpStore.delete(formattedPhone);
      return res.status(429).json({
        success: false,
        error: 'Too many incorrect attempts. This OTP has been invalidated for security. Please request a new OTP.'
      });
    }

    if (record.otp !== otp.toString().trim()) {
      record.attempts += 1;
      return res.status(400).json({
        success: false,
        error: `Invalid OTP. ${MAX_OTP_ATTEMPTS - record.attempts} attempt(s) remaining.`
      });
    }

    // OTP verified successfully -> clear from store
    otpStore.delete(formattedPhone);

    // Look for existing user
    let user = await prisma.user.findUnique({
      where: { phoneNumber: formattedPhone },
      include: { farmerProfile: true }
    });

    if (user && user.role !== 'FARMER') {
      return res.status(403).json({
        success: false,
        error: 'This phone number is not registered as a farmer'
      });
    }

    if (!user) {
      // Register new farmer
      user = await prisma.user.create({
        data: {
          phoneNumber: formattedPhone,
          name: name || 'Farmer Partner',
          role: 'FARMER',
          preferredLang: preferredLang || 'kn',
          farmerProfile: {
            create: {
              state: state || 'Karnataka',
              district: district || 'General',
              village: village || '',
              upiId: upiId || ''
            }
          }
        },
        include: { farmerProfile: true }
      });
    }

    const token = generateToken(user);

    return res.status(200).json({
      success: true,
      message: 'Farmer authenticated successfully',
      token,
      user: sanitizeUser(user)
    });
  } catch (error) {
    console.error('Error in verifyFarmerOtp:', error);
    return res.status(500).json({ success: false, error: 'Internal server error during OTP verification' });
  }
};

/**
 * POST /api/auth/buyer/register
 * Registers a new commercial buyer with >= 8 character password constraint.
 */
const registerBuyer = async (req, res) => {
  try {
    const {
      name,
      email,
      phoneNumber,
      password,
      businessName,
      businessType,
      shippingAddress,
      gstin,
      preferredLang
    } = req.body;

    if (!name || !email || !phoneNumber || !password) {
      return res.status(400).json({
        success: false,
        error: 'name, email, phoneNumber, and password are required'
      });
    }

    // Minimum password length validation
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters long'
      });
    }

    const formattedPhone = phoneNumber.startsWith('+91')
      ? phoneNumber.trim()
      : `+91${phoneNumber.replace(/^0+/, '').trim()}`;

    // Check if user already exists
    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ email: email.toLowerCase().trim() }, { phoneNumber: formattedPhone }]
      }
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'An account with this email or phone number already exists'
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        phoneNumber: formattedPhone,
        passwordHash,
        role: 'BUYER',
        preferredLang: preferredLang || 'en',
        buyerProfile: {
          create: {
            businessName: businessName || null,
            businessType: businessType || 'Supermarket',
            shippingAddress: shippingAddress || null,
            gstin: gstin || null
          }
        }
      },
      include: { buyerProfile: true }
    });

    const token = generateToken(user);

    return res.status(201).json({
      success: true,
      message: 'Buyer registered successfully',
      token,
      user: sanitizeUser(user)
    });
  } catch (error) {
    console.error('Error in registerBuyer:', error);
    return res.status(500).json({ success: false, error: 'Internal server error during buyer registration' });
  }
};

/**
 * POST /api/auth/login
 * Email + password login for Buyers and Admin.
 */
const loginWithPassword = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: {
        farmerProfile: true,
        buyerProfile: true
      }
    });

    if (!user || !user.passwordHash) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    const token = generateToken(user);

    return res.status(200).json({
      success: true,
      message: `Logged in successfully as ${user.role}`,
      token,
      user: sanitizeUser(user)
    });
  } catch (error) {
    console.error('Error in loginWithPassword:', error);
    return res.status(500).json({ success: false, error: 'Internal server error during login' });
  }
};

/**
 * GET /api/auth/me
 * Returns current authenticated user and linked profile.
 */
const getMe = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        farmerProfile: true,
        buyerProfile: true
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    return res.status(200).json({
      success: true,
      user: sanitizeUser(user)
    });
  } catch (error) {
    console.error('Error in getMe:', error);
    return res.status(500).json({ success: false, error: 'Internal server error fetching profile' });
  }
};

module.exports = {
  sendFarmerOtp,
  verifyFarmerOtp,
  registerBuyer,
  loginWithPassword,
  getMe
};
