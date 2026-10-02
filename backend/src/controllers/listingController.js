const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');

// Allowed high-value crop names per project requirements
const ALLOWED_CROPS = [
  'Avocado',
  'Dragon Fruit',
  'Pomegranate',
  'Coffee',
  'Banana'
];

// Allowed sort options for public listings browse
const ALLOWED_SORTS = ['newest', 'priceAsc', 'priceDesc'];

// Reusable safe farmer select projection to prevent leaking sensitive fields
const SAFE_FARMER_SELECT = {
  select: {
    state: true,
    district: true,
    user: {
      select: {
        name: true
      }
    }
  }
};

/**
 * Validates whether a string is a valid URL with http: or https: protocol
 */
const isValidHttpUrl = (urlString) => {
  try {
    const parsed = new URL(urlString);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * POST /api/listings
 * FARMER only: Create a new crop listing for advance buyer orders.
 */
const createListing = async (req, res) => {
  try {
    const {
      cropName,
      variety,
      totalQuantityKg,
      askingPricePerKg,
      expectedHarvestDate,
      location,
      photoUrl
    } = req.body;

    // 1. Validate required fields presence
    if (!cropName || totalQuantityKg === undefined || askingPricePerKg === undefined || !expectedHarvestDate || !location) {
      return res.status(400).json({
        success: false,
        error: 'cropName, totalQuantityKg, askingPricePerKg, expectedHarvestDate, and location are required'
      });
    }

    // 2. Validate cropName restriction
    const trimmedCrop = String(cropName).trim();
    const matchedCrop = ALLOWED_CROPS.find(
      (c) => c.toLowerCase() === trimmedCrop.toLowerCase()
    );
    if (!matchedCrop) {
      return res.status(400).json({
        success: false,
        error: `Invalid cropName: "${cropName}". Allowed crops are: ${ALLOWED_CROPS.join(', ')}`
      });
    }

    // 3. Strict numeric validation using Number() and Number.isFinite()
    const qty = Number(totalQuantityKg);
    const price = Number(askingPricePerKg);

    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({
        success: false,
        error: 'totalQuantityKg must be a positive finite number greater than 0'
      });
    }

    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({
        success: false,
        error: 'askingPricePerKg must be a positive finite number greater than 0'
      });
    }

    // 4. Validate expectedHarvestDate is a valid date strictly in the future
    const parsedDate = new Date(expectedHarvestDate);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'expectedHarvestDate must be a valid ISO date string'
      });
    }

    if (parsedDate <= new Date()) {
      return res.status(400).json({
        success: false,
        error: 'expectedHarvestDate must be a date in the future'
      });
    }

    // 5. Validate location is not empty
    const trimmedLocation = String(location).trim();
    if (!trimmedLocation) {
      return res.status(400).json({
        success: false,
        error: 'location cannot be empty'
      });
    }

    // 6. Validate optional photoUrl if provided
    let trimmedPhotoUrl = null;
    if (photoUrl !== undefined && photoUrl !== null && String(photoUrl).trim() !== '') {
      trimmedPhotoUrl = String(photoUrl).trim();
      if (!isValidHttpUrl(trimmedPhotoUrl)) {
        return res.status(400).json({
          success: false,
          error: 'photoUrl must be a valid URL starting with http:// or https://'
        });
      }
    }

    // 7. Lookup FarmerProfile for the authenticated user (User id -> FarmerProfile id)
    const farmerProfile = await prisma.farmerProfile.findUnique({
      where: { userId: req.user.id }
    });

    if (!farmerProfile) {
      return res.status(404).json({
        success: false,
        error: 'Farmer profile not found for this user account'
      });
    }

    // 8. TODO: Phase 6 - Fetch suggested price range from ML Price advisory service (FastAPI)
    const suggestedMinPrice = null;
    const suggestedMaxPrice = null;

    // 9. Create listing with availableQuantityKg initialized equal to totalQuantityKg
    const listing = await prisma.cropListing.create({
      data: {
        farmerId: farmerProfile.id,
        cropName: matchedCrop,
        variety: variety ? String(variety).trim() : null,
        totalQuantityKg: qty,
        availableQuantityKg: qty,
        askingPricePerKg: price,
        suggestedMinPrice,
        suggestedMaxPrice,
        expectedHarvestDate: parsedDate,
        location: trimmedLocation,
        photoUrl: trimmedPhotoUrl,
        isActive: true
      },
      include: {
        farmer: SAFE_FARMER_SELECT
      }
    });

    return res.status(201).json({
      success: true,
      message: 'Listing created successfully',
      listing
    });
  } catch (error) {
    console.error('Error in createListing:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error while creating listing'
    });
  }
};

/**
 * GET /api/listings
 * Public: Browse active listings with availableQuantityKg > 0.
 * Supports filters (cropName, location, minPrice, maxPrice, harvestBefore, harvestAfter),
 * pagination (page, limit capped at 50), and sorting (newest, priceAsc, priceDesc).
 */
const getActiveListings = async (req, res) => {
  try {
    const {
      cropName,
      location,
      minPrice,
      maxPrice,
      harvestBefore,
      harvestAfter,
      sort = 'newest',
      page = 1,
      limit = 10
    } = req.query;

    // 1. Strict pagination validation
    const pageNum = Number(page);
    if (!Number.isInteger(pageNum) || pageNum < 1) {
      return res.status(400).json({
        success: false,
        error: 'page must be a positive integer greater than or equal to 1'
      });
    }

    const limitNum = Number(limit);
    if (!Number.isInteger(limitNum) || limitNum < 1) {
      return res.status(400).json({
        success: false,
        error: 'limit must be a positive integer greater than or equal to 1'
      });
    }

    const pageSize = Math.min(50, limitNum);
    const skip = (pageNum - 1) * pageSize;

    // 2. Strict sort validation
    if (!ALLOWED_SORTS.includes(sort)) {
      return res.status(400).json({
        success: false,
        error: `Invalid sort parameter: "${sort}". Allowed values are: ${ALLOWED_SORTS.join(', ')}`
      });
    }

    // 3. Build filter condition: must be active and have available stock
    const where = {
      isActive: true,
      availableQuantityKg: { gt: 0 }
    };

    if (cropName && String(cropName).trim()) {
      where.cropName = {
        contains: String(cropName).trim(),
        mode: 'insensitive'
      };
    }

    if (location && String(location).trim()) {
      where.location = {
        contains: String(location).trim(),
        mode: 'insensitive'
      };
    }

    // 4. Strict price filters validation
    let parsedMin = undefined;
    let parsedMax = undefined;

    if (minPrice !== undefined) {
      parsedMin = Number(minPrice);
      if (!Number.isFinite(parsedMin) || parsedMin < 0) {
        return res.status(400).json({
          success: false,
          error: 'minPrice must be a valid non-negative finite number'
        });
      }
    }

    if (maxPrice !== undefined) {
      parsedMax = Number(maxPrice);
      if (!Number.isFinite(parsedMax) || parsedMax < 0) {
        return res.status(400).json({
          success: false,
          error: 'maxPrice must be a valid non-negative finite number'
        });
      }
    }

    if (parsedMin !== undefined && parsedMax !== undefined && parsedMin > parsedMax) {
      return res.status(400).json({
        success: false,
        error: 'minPrice cannot be greater than maxPrice'
      });
    }

    if (parsedMin !== undefined || parsedMax !== undefined) {
      where.askingPricePerKg = {};
      if (parsedMin !== undefined) where.askingPricePerKg.gte = parsedMin;
      if (parsedMax !== undefined) where.askingPricePerKg.lte = parsedMax;
    }

    // 5. Strict date filters validation
    if (harvestBefore !== undefined || harvestAfter !== undefined) {
      where.expectedHarvestDate = {};

      if (harvestAfter !== undefined) {
        const afterDate = new Date(harvestAfter);
        if (isNaN(afterDate.getTime())) {
          return res.status(400).json({
            success: false,
            error: 'harvestAfter must be a valid ISO date string'
          });
        }
        where.expectedHarvestDate.gte = afterDate;
      }

      if (harvestBefore !== undefined) {
        const beforeDate = new Date(harvestBefore);
        if (isNaN(beforeDate.getTime())) {
          return res.status(400).json({
            success: false,
            error: 'harvestBefore must be a valid ISO date string'
          });
        }
        where.expectedHarvestDate.lte = beforeDate;
      }
    }

    // 6. Determine sort ordering
    let orderBy = { createdAt: 'desc' };
    if (sort === 'priceAsc') {
      orderBy = { askingPricePerKg: 'asc' };
    } else if (sort === 'priceDesc') {
      orderBy = { askingPricePerKg: 'desc' };
    } else if (sort === 'newest') {
      orderBy = { createdAt: 'desc' };
    }

    // Parallel count and fetch
    const [total, listings] = await Promise.all([
      prisma.cropListing.count({ where }),
      prisma.cropListing.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
        include: {
          farmer: SAFE_FARMER_SELECT
        }
      })
    ]);

    return res.status(200).json({
      success: true,
      total,
      page: pageNum,
      limit: pageSize,
      totalPages: Math.ceil(total / pageSize),
      listings
    });
  } catch (error) {
    console.error('Error in getActiveListings:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error fetching listings'
    });
  }
};

/**
 * GET /api/listings/mine
 * FARMER only: Fetch all listings owned by the logged-in farmer (active and inactive).
 */
const getMyListings = async (req, res) => {
  try {
    const farmerProfile = await prisma.farmerProfile.findUnique({
      where: { userId: req.user.id }
    });

    if (!farmerProfile) {
      return res.status(404).json({
        success: false,
        error: 'Farmer profile not found for this user account'
      });
    }

    const [total, listings] = await Promise.all([
      prisma.cropListing.count({ where: { farmerId: farmerProfile.id } }),
      prisma.cropListing.findMany({
        where: { farmerId: farmerProfile.id },
        orderBy: { createdAt: 'desc' },
        include: {
          farmer: SAFE_FARMER_SELECT,
          _count: {
            select: { orders: true }
          }
        }
      })
    ]);

    return res.status(200).json({
      success: true,
      total,
      listings
    });
  } catch (error) {
    console.error('Error in getMyListings:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error fetching your listings'
    });
  }
};

/**
 * GET /api/listings/:id
 * Public: Fetch a single listing by ID.
 * Inactive listings are hidden from public view unless requested by the owning farmer.
 */
const getListingById = async (req, res) => {
  try {
    const { id } = req.params;

    const listing = await prisma.cropListing.findUnique({
      where: { id },
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
    });

    if (!listing) {
      return res.status(404).json({
        success: false,
        error: 'Listing not found'
      });
    }

    // Inactive listings are visible only to the owning farmer
    if (!listing.isActive) {
      let currentUserId = null;
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const token = authHeader.split(' ')[1];
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          currentUserId = decoded.id;
        } catch {
          // Token invalid or expired -> treated as unauthenticated
        }
      }

      if (!currentUserId || currentUserId !== listing.farmer.userId) {
        return res.status(404).json({
          success: false,
          error: 'Listing not found'
        });
      }
    }

    // Strip internal IDs before responding
    const safeListing = {
      ...listing,
      farmer: {
        state: listing.farmer.state,
        district: listing.farmer.district,
        user: {
          name: listing.farmer.user.name
        }
      }
    };

    return res.status(200).json({
      success: true,
      listing: safeListing
    });
  } catch (error) {
    console.error('Error in getListingById:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error fetching listing details'
    });
  }
};

/**
 * PATCH /api/listings/:id
 * FARMER only: Update listing fields. Only the owning farmer can update.
 * If totalQuantityKg changes, availableQuantityKg is adjusted by relative delta via atomic updateMany.
 * Rejects with 400 if availableQuantityKg would fall below 0.
 */
const updateListing = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      askingPricePerKg,
      expectedHarvestDate,
      location,
      photoUrl,
      variety,
      totalQuantityKg
    } = req.body;

    // 1. Check existing listing and verify ownership
    const existing = await prisma.cropListing.findUnique({
      where: { id },
      include: { farmer: true }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Listing not found'
      });
    }

    if (existing.farmer.userId !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: You can only update your own listings'
      });
    }

    const dataToUpdate = {};

    if (variety !== undefined) {
      dataToUpdate.variety = variety ? String(variety).trim() : null;
    }

    if (location !== undefined) {
      const trimmedLoc = String(location).trim();
      if (!trimmedLoc) {
        return res.status(400).json({ success: false, error: 'location cannot be empty' });
      }
      dataToUpdate.location = trimmedLoc;
    }

    if (photoUrl !== undefined) {
      if (photoUrl === null || String(photoUrl).trim() === '') {
        dataToUpdate.photoUrl = null;
      } else {
        const trimmedPhoto = String(photoUrl).trim();
        if (!isValidHttpUrl(trimmedPhoto)) {
          return res.status(400).json({
            success: false,
            error: 'photoUrl must be a valid URL starting with http:// or https://'
          });
        }
        dataToUpdate.photoUrl = trimmedPhoto;
      }
    }

    if (askingPricePerKg !== undefined) {
      const price = Number(askingPricePerKg);
      if (!Number.isFinite(price) || price <= 0) {
        return res.status(400).json({
          success: false,
          error: 'askingPricePerKg must be a positive finite number greater than 0'
        });
      }
      dataToUpdate.askingPricePerKg = price;
    }

    if (expectedHarvestDate !== undefined) {
      const date = new Date(expectedHarvestDate);
      if (isNaN(date.getTime())) {
        return res.status(400).json({
          success: false,
          error: 'expectedHarvestDate must be a valid ISO date string'
        });
      }
      if (date <= new Date()) {
        return res.status(400).json({
          success: false,
          error: 'expectedHarvestDate must be a date in the future'
        });
      }
      dataToUpdate.expectedHarvestDate = date;
    }

    // 2. Handle atomic quantity adjustment
    let delta = 0;
    let hasQuantityChange = false;

    if (totalQuantityKg !== undefined) {
      const parsedNewTotal = Number(totalQuantityKg);
      if (!Number.isFinite(parsedNewTotal) || parsedNewTotal <= 0) {
        return res.status(400).json({
          success: false,
          error: 'totalQuantityKg must be a positive finite number greater than 0'
        });
      }

      delta = parsedNewTotal - existing.totalQuantityKg;
      hasQuantityChange = true;
      dataToUpdate.totalQuantityKg = parsedNewTotal;
      dataToUpdate.availableQuantityKg = { increment: delta };
    }

    // If no updatable fields were supplied in the body, return the current listing unchanged
    if (Object.keys(dataToUpdate).length === 0) {
      const current = await prisma.cropListing.findUnique({
        where: { id },
        include: { farmer: SAFE_FARMER_SELECT }
      });
      return res.status(200).json({
        success: true,
        message: 'No changes provided; listing remains unchanged',
        listing: current
      });
    }

    // 3. Atomic update using updateMany with conditional gte check when delta < 0
    const whereClause = { id };
    if (hasQuantityChange && delta < 0) {
      // Guard against available quantity dropping below 0 due to concurrent orders
      whereClause.availableQuantityKg = { gte: -delta };
    }

    const updateResult = await prisma.cropListing.updateMany({
      where: whereClause,
      data: dataToUpdate
    });

    if (updateResult.count === 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot reduce total quantity below the amount already reserved by orders'
      });
    }

    // 4. Fetch updated listing with safe projection
    const updated = await prisma.cropListing.findUnique({
      where: { id },
      include: {
        farmer: SAFE_FARMER_SELECT
      }
    });

    return res.status(200).json({
      success: true,
      message: 'Listing updated successfully',
      listing: updated
    });
  } catch (error) {
    console.error('Error in updateListing:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error while updating listing'
    });
  }
};

/**
 * DELETE /api/listings/:id
 * FARMER only: Soft delete (set isActive = false). Only the owning farmer can soft delete.
 */
const deleteListing = async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await prisma.cropListing.findUnique({
      where: { id },
      include: { farmer: true }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Listing not found'
      });
    }

    if (existing.farmer.userId !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: You can only delete your own listings'
      });
    }

    await prisma.cropListing.update({
      where: { id },
      data: { isActive: false }
    });

    return res.status(200).json({
      success: true,
      message: 'Listing deactivated successfully'
    });
  } catch (error) {
    console.error('Error in deleteListing:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error while deleting listing'
    });
  }
};

module.exports = {
  createListing,
  getMyListings,
  getActiveListings,
  getListingById,
  updateListing,
  deleteListing
};
