const crypto = require('crypto');
const prisma = require('../config/prisma');

/**
 * Helper to safely sanitize buyer details before returning to farmers / non-admins
 * Excludes email, phoneNumber, and passwordHash.
 */
const sanitizeBuyerForFarmer = (buyer) => {
  if (!buyer) return null;
  return {
    name: buyer.name,
    buyerProfile: buyer.buyerProfile
      ? {
          businessName: buyer.buyerProfile.businessName,
          businessType: buyer.buyerProfile.businessType,
          shippingAddress: buyer.buyerProfile.shippingAddress
        }
      : null
  };
};

/**
 * POST /api/orders
 * BUYER only: Place an advance order on a crop listing with atomic inventory decrement.
 */
const createOrder = async (req, res) => {
  try {
    const { listingId, quantityKg, deliveryAddress } = req.body;

    // 1. Validate required fields
    if (!listingId || quantityKg === undefined || !deliveryAddress) {
      return res.status(400).json({
        success: false,
        error: 'listingId, quantityKg, and deliveryAddress are required'
      });
    }

    const qty = Number(quantityKg);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({
        success: false,
        error: 'quantityKg must be a positive finite number greater than 0'
      });
    }

    const trimmedAddress = String(deliveryAddress).trim();
    if (!trimmedAddress) {
      return res.status(400).json({
        success: false,
        error: 'deliveryAddress cannot be empty'
      });
    }

    // 2. Fetch the target crop listing
    const listing = await prisma.cropListing.findUnique({
      where: { id: String(listingId) },
      include: {
        farmer: {
          select: {
            id: true,
            userId: true
          }
        }
      }
    });

    if (!listing) {
      return res.status(404).json({
        success: false,
        error: 'Listing not found'
      });
    }

    if (!listing.isActive) {
      return res.status(400).json({
        success: false,
        error: 'Listing is no longer active for orders'
      });
    }

    // Take pricePerKg directly from the database listing askingPricePerKg (NEVER from client request body)
    const pricePerKg = listing.askingPricePerKg;
    const totalAmount = Math.round(qty * pricePerKg * 100) / 100;
    const orderNumber = `KS-ORD-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    // 3. Atomically reserve inventory and create order in the same transaction
    const newOrder = await prisma.$transaction(async (tx) => {
      // Conditional decrement: ensures listing is still active and has enough stock
      const updateResult = await tx.cropListing.updateMany({
        where: {
          id: listing.id,
          isActive: true,
          availableQuantityKg: { gte: qty }
        },
        data: {
          availableQuantityKg: { decrement: qty }
        }
      });

      if (updateResult.count === 0) {
        const err = new Error('Insufficient stock');
        err.statusCode = 400;
        throw err;
      }

      // Create Order with status PLACED
      const order = await tx.order.create({
        data: {
          orderNumber,
          buyerId: req.user.id,
          listingId: listing.id,
          quantityKg: qty,
          pricePerKg,
          totalAmount,
          status: 'PLACED',
          deliveryAddress: trimmedAddress
        },
        include: {
          listing: {
            select: {
              id: true,
              cropName: true,
              variety: true,
              location: true,
              photoUrl: true,
              farmer: {
                select: {
                  state: true,
                  district: true,
                  user: {
                    select: {
                      name: true
                    }
                  }
                }
              }
            }
          }
        }
      });

      // Create a Notification row for the farmer (listing owner)
      await tx.notification.create({
        data: {
          userId: listing.farmer.userId,
          title: 'New Order Received',
          message: `New order ${orderNumber} placed for ${qty}kg of ${listing.cropName}. Total: ₹${totalAmount}.`
        }
      });

      return order;
    });

    return res.status(201).json({
      success: true,
      message: 'Order placed successfully',
      order: newOrder
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.message
      });
    }
    console.error('Error in createOrder:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error while placing order'
    });
  }
};

/**
 * GET /api/orders/mine
 * BUYER only: View own orders with listing summary, ordered newest first.
 */
const getBuyerOrders = async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      where: { buyerId: req.user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        listing: {
          select: {
            id: true,
            cropName: true,
            variety: true,
            location: true,
            photoUrl: true,
            farmer: {
              select: {
                state: true,
                district: true,
                user: {
                  select: {
                    name: true
                  }
                }
              }
            }
          }
        },
        payment: {
          select: {
            status: true,
            amount: true,
            razorpayPaymentId: true,
            createdAt: true
          }
        }
      }
    });

    return res.status(200).json({
      success: true,
      count: orders.length,
      orders
    });
  } catch (error) {
    console.error('Error in getBuyerOrders:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error fetching buyer orders'
    });
  }
};

/**
 * GET /api/orders/incoming
 * FARMER only: Orders placed on the logged-in farmer's listings.
 * Sanitizes buyer details (only businessName and shippingAddress, never email, phone or passwordHash).
 */
const getIncomingOrders = async (req, res) => {
  try {
    // Lookup FarmerProfile id
    const farmerProfile = await prisma.farmerProfile.findUnique({
      where: { userId: req.user.id }
    });

    if (!farmerProfile) {
      return res.status(404).json({
        success: false,
        error: 'Farmer profile not found for this user account'
      });
    }

    const orders = await prisma.order.findMany({
      where: {
        listing: {
          farmerId: farmerProfile.id
        }
      },
      orderBy: { createdAt: 'desc' },
      include: {
        buyer: {
          select: {
            name: true,
            buyerProfile: {
              select: {
                businessName: true,
                businessType: true,
                shippingAddress: true
              }
            }
          }
        },
        listing: {
          select: {
            id: true,
            cropName: true,
            variety: true,
            expectedHarvestDate: true,
            location: true
          }
        },
        payment: {
          select: {
            status: true,
            amount: true,
            createdAt: true
          }
        }
      }
    });

    // Sanitize buyer objects across list
    const sanitizedOrders = orders.map((ord) => ({
      ...ord,
      buyer: sanitizeBuyerForFarmer(ord.buyer)
    }));

    return res.status(200).json({
      success: true,
      count: sanitizedOrders.length,
      orders: sanitizedOrders
    });
  } catch (error) {
    console.error('Error in getIncomingOrders:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error fetching incoming farmer orders'
    });
  }
};

/**
 * GET /api/orders/:id
 * Single order details: Accessible only by order's buyer, listing's farmer, or ADMIN.
 */
const getOrderById = async (req, res) => {
  try {
    const { id } = req.params;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        listing: {
          include: {
            farmer: {
              select: {
                id: true,
                userId: true,
                state: true,
                district: true,
                user: {
                  select: {
                    name: true
                  }
                }
              }
            }
          }
        },
        buyer: {
          select: {
            id: true,
            name: true,
            buyerProfile: {
              select: {
                businessName: true,
                businessType: true,
                shippingAddress: true
              }
            }
          }
        },
        payment: {
          select: {
            status: true,
            amount: true,
            currency: true,
            razorpayPaymentId: true,
            createdAt: true
          }
        }
      }
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    const isBuyerOwner = order.buyerId === req.user.id;
    const isFarmerOwner = order.listing && order.listing.farmer && order.listing.farmer.userId === req.user.id;
    const isAdmin = req.user.role === 'ADMIN';

    if (!isBuyerOwner && !isFarmerOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: You do not have permission to view this order'
      });
    }

    // Sanitize buyer info for non-admins to ensure phone/email are never exposed
    const sanitizedOrder = {
      ...order,
      buyer: sanitizeBuyerForFarmer(order.buyer),
      listing: {
        id: order.listing.id,
        cropName: order.listing.cropName,
        variety: order.listing.variety,
        askingPricePerKg: order.listing.askingPricePerKg,
        expectedHarvestDate: order.listing.expectedHarvestDate,
        location: order.listing.location,
        photoUrl: order.listing.photoUrl,
        farmer: {
          state: order.listing.farmer.state,
          district: order.listing.farmer.district,
          user: {
            name: order.listing.farmer.user.name
          }
        }
      }
    };

    return res.status(200).json({
      success: true,
      order: sanitizedOrder
    });
  } catch (error) {
    console.error('Error in getOrderById:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error fetching order details'
    });
  }
};

/**
 * PATCH /api/orders/:id/status
 * State machine status transitions:
 * Farmer (listing owner): PLACED -> ACCEPTED, PLACED -> CANCELLED, ACCEPTED -> SHIPPED
 * Buyer (order owner): PLACED -> CANCELLED, SHIPPED -> DELIVERED
 * Cancelling restores availableQuantityKg atomically in the same transaction.
 * If cancelling a paid order (Payment COMPLETED), marks Payment as REFUNDED.
 */
const updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status: nextStatus } = req.body;

    if (!nextStatus) {
      return res.status(400).json({
        success: false,
        error: 'status field is required in request body'
      });
    }

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        listing: {
          include: {
            farmer: true
          }
        },
        payment: true
      }
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    const currentStatus = order.status;
    const isBuyer = order.buyerId === req.user.id;
    const isFarmer = order.listing && order.listing.farmer && order.listing.farmer.userId === req.user.id;

    if (!isBuyer && !isFarmer) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: You do not have permission to update this order status'
      });
    }

    // State machine transition validation
    let isAllowed = false;

    if (isFarmer) {
      if (currentStatus === 'PLACED' && (nextStatus === 'ACCEPTED' || nextStatus === 'CANCELLED')) {
        isAllowed = true;
      } else if (currentStatus === 'ACCEPTED' && nextStatus === 'SHIPPED') {
        isAllowed = true;
      }
    }

    if (isBuyer) {
      if (currentStatus === 'PLACED' && nextStatus === 'CANCELLED') {
        isAllowed = true;
      } else if (currentStatus === 'SHIPPED' && nextStatus === 'DELIVERED') {
        isAllowed = true;
      }
    }

    if (!isAllowed) {
      return res.status(400).json({
        success: false,
        error: `Invalid status transition: Cannot change order from ${currentStatus} to ${nextStatus} as ${isFarmer ? 'FARMER' : 'BUYER'}`
      });
    }

    // Execute state update inside transaction
    const updated = await prisma.$transaction(async (tx) => {
      // 1. Guard against race conditions / double-cancels by targeting the expected currentStatus
      const updateResult = await tx.order.updateMany({
        where: {
          id,
          status: currentStatus
        },
        data: {
          status: nextStatus
        }
      });

      if (updateResult.count === 0) {
        const conflictErr = new Error(`Order status has already changed or was concurrently updated`);
        conflictErr.statusCode = 400;
        throw conflictErr;
      }

      let isRefundProcessed = false;

      // 2. If transitioning to CANCELLED, atomically restore reserved crop inventory
      if (nextStatus === 'CANCELLED') {
        await tx.cropListing.update({
          where: { id: order.listingId },
          data: {
            availableQuantityKg: { increment: order.quantityKg }
          }
        });

        // 2b. If cancelling an already-paid order, mark payment as REFUNDED
        if (order.payment && order.payment.status === 'COMPLETED') {
          // NOTE: In production, a call to Razorpay's payments.refund API would be executed here:
          // await razorpayInstance.payments.refund(order.payment.razorpayPaymentId, { amount: amountPaise });
          // For this major project, the external refund gateway call is out of scope and simulated locally.
          console.log(`\n======================================================`);
          console.log(`💸 [PAYMENT REFUND SIMULATION] Order ${order.orderNumber}`);
          console.log(`Payment ID : ${order.payment.razorpayPaymentId || order.payment.razorpayOrderId}`);
          console.log(`Amount     : ₹${order.payment.amount}`);
          console.log(`Status     : Marked as REFUNDED. (Real Razorpay refund API call is out of scope and would be made here)`);
          console.log(`======================================================\n`);

          await tx.payment.update({
            where: { orderId: order.id },
            data: { status: 'REFUNDED' }
          });

          isRefundProcessed = true;
        }
      }

      // 3. Notify the opposite party
      const notifyUserId = isFarmer ? order.buyerId : order.listing.farmer.userId;
      const actorRole = isFarmer ? 'farmer' : 'buyer';
      
      let notifyMessage = `Order ${order.orderNumber} has been updated to ${nextStatus} by the ${actorRole}.`;
      if (nextStatus === 'CANCELLED' && isRefundProcessed) {
        notifyMessage += ` Payment of ₹${order.payment.amount} has been marked as REFUNDED.`;
      }

      await tx.notification.create({
        data: {
          userId: notifyUserId,
          title: `Order Status: ${nextStatus}`,
          message: notifyMessage
        }
      });

      return await tx.order.findUnique({
        where: { id },
        include: {
          listing: {
            select: {
              cropName: true,
              variety: true
            }
          },
          payment: true
        }
      });
    });

    return res.status(200).json({
      success: true,
      message: `Order status updated to ${nextStatus}`,
      order: updated
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.message
      });
    }
    console.error('Error in updateOrderStatus:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error while updating order status'
    });
  }
};

/**
 * POST /api/orders/:id/pay
 * BUYER only (order owner): Initiates Razorpay payment order.
 * Amount is converted to integer paise.
 * In dev/demo mode when RAZORPAY_KEY_ID is missing or mock ('rzp_test_mock...'),
 * runs in MOCK PAYMENT MODE with simulated gateway order ID.
 */
const createRazorpayOrder = async (req, res) => {
  try {
    const { id } = req.params;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        payment: true
      }
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    if (order.buyerId !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: You can only initiate payment for your own orders'
      });
    }

    if (order.status === 'CANCELLED') {
      return res.status(400).json({
        success: false,
        error: 'Cannot initiate payment for a cancelled order'
      });
    }

    if (order.payment && order.payment.status === 'COMPLETED') {
      return res.status(400).json({
        success: false,
        error: 'This order has already been paid in full'
      });
    }

    // Convert amount to integer paise
    const amountPaise = Math.round(order.totalAmount * 100);

    const isMockMode =
      !process.env.RAZORPAY_KEY_ID ||
      process.env.RAZORPAY_KEY_ID.startsWith('rzp_test_mock');

    let razorpayOrderId;

    if (isMockMode) {
      // Mock mode logging
      console.log('\n======================================================');
      console.log('💳 [MOCK PAYMENT MODE] Razorpay Gateway Simulation');
      console.log(`Order Number : ${order.orderNumber}`);
      console.log(`Order Total  : ₹${order.totalAmount} (${amountPaise} paise)`);
      console.log('Mode         : Mock Key Detected (rzp_test_mock...)');
      console.log('======================================================\n');

      razorpayOrderId = `order_mock_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    } else {
      const Razorpay = require('razorpay');
      const razorpayInstance = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
      });

      const rzpOrder = await razorpayInstance.orders.create({
        amount: amountPaise,
        currency: 'INR',
        receipt: order.orderNumber,
        notes: {
          orderId: order.id,
          buyerId: order.buyerId
        }
      });
      razorpayOrderId = rzpOrder.id;
    }

    // Upsert Payment record as PENDING
    await prisma.payment.upsert({
      where: { orderId: order.id },
      create: {
        orderId: order.id,
        razorpayOrderId,
        amount: order.totalAmount,
        currency: 'INR',
        status: 'PENDING'
      },
      update: {
        razorpayOrderId,
        amount: order.totalAmount,
        status: 'PENDING'
      }
    });

    // Return only public key ID, never key secret
    return res.status(200).json({
      success: true,
      razorpayOrderId,
      amount: amountPaise,
      currency: 'INR',
      keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_mock_key_id'
    });
  } catch (error) {
    console.error('Error in createRazorpayOrder:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error creating payment order'
    });
  }
};

/**
 * POST /api/orders/:id/verify-payment
 * BUYER only: Validates HMAC SHA256 signature using crypto.timingSafeEqual.
 * Reject with 400 if order is CANCELLED.
 * Requires RAZORPAY_KEY_SECRET from .env with no hardcoded fallback.
 * Idempotent: returns 200 with existing status if already COMPLETED.
 * Atomic update guard on PENDING prevents duplicate notifications.
 */
const verifyPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return res.status(400).json({
        success: false,
        error: 'razorpayOrderId, razorpayPaymentId, and razorpaySignature are required'
      });
    }

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        payment: true,
        listing: {
          include: { farmer: true }
        }
      }
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    if (order.buyerId !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: You can only verify payments for your own orders'
      });
    }

    // 2. Reject verification if order is cancelled
    if (order.status === 'CANCELLED') {
      return res.status(400).json({
        success: false,
        error: 'Cannot verify payment for a cancelled order'
      });
    }

    if (!order.payment) {
      return res.status(400).json({
        success: false,
        error: 'No payment record found for this order. Please initiate payment first.'
      });
    }

    // 4a. Idempotency check: if payment is already COMPLETED, return success immediately
    if (order.payment.status === 'COMPLETED') {
      return res.status(200).json({
        success: true,
        message: 'Payment already verified and completed',
        payment: {
          status: order.payment.status,
          amount: order.payment.amount,
          razorpayPaymentId: order.payment.razorpayPaymentId
        }
      });
    }

    if (order.payment.razorpayOrderId !== razorpayOrderId) {
      return res.status(400).json({
        success: false,
        error: 'razorpayOrderId mismatch'
      });
    }

    // 3. Strict secret check: secret must come from .env (no hardcoded fallback)
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      console.error('FATAL: RAZORPAY_KEY_SECRET is not configured in environment variables');
      return res.status(500).json({
        success: false,
        error: 'Payment gateway not configured'
      });
    }

    // Compute expected HMAC SHA256 signature
    const payload = `${razorpayOrderId}|${razorpayPaymentId}`;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    // Use crypto.timingSafeEqual to prevent timing attacks
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    const actualBuffer = Buffer.from(String(razorpaySignature), 'utf8');

    const isMatch =
      expectedBuffer.length === actualBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, actualBuffer);

    if (!isMatch) {
      return res.status(400).json({
        success: false,
        error: 'Invalid payment signature. Verification failed.'
      });
    }

    // 4b. Atomic update guard: only transition from PENDING to COMPLETED
    const updateResult = await prisma.payment.updateMany({
      where: {
        orderId: order.id,
        status: 'PENDING'
      },
      data: {
        status: 'COMPLETED',
        razorpayPaymentId: String(razorpayPaymentId),
        razorpaySignature: String(razorpaySignature)
      }
    });

    if (updateResult.count === 0) {
      // Payment was already marked COMPLETED by a concurrent request
      const freshPayment = await prisma.payment.findUnique({
        where: { orderId: order.id }
      });
      return res.status(200).json({
        success: true,
        message: 'Payment already verified and completed',
        payment: {
          status: freshPayment.status,
          amount: freshPayment.amount,
          razorpayPaymentId: freshPayment.razorpayPaymentId
        }
      });
    }

    // First completion: notify farmer of received payment
    await prisma.notification.create({
      data: {
        userId: order.listing.farmer.userId,
        title: 'Payment Received',
        message: `Payment of ₹${order.totalAmount} for order ${order.orderNumber} has been received and verified.`
      }
    });

    return res.status(200).json({
      success: true,
      message: 'Payment verified successfully',
      payment: {
        status: 'COMPLETED',
        amount: order.totalAmount,
        razorpayPaymentId: String(razorpayPaymentId)
      }
    });
  } catch (error) {
    console.error('Error in verifyPayment:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error verifying payment'
    });
  }
};

module.exports = {
  createOrder,
  getBuyerOrders,
  getIncomingOrders,
  getOrderById,
  updateOrderStatus,
  createRazorpayOrder,
  verifyPayment
};
