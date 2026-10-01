const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');

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
      photoUrl,
      suggestedMinPrice,
      suggestedMaxPrice
    } = req.body;

    // Validate required fields
    if (!cropName || !totalQuantityKg || !askingPricePerKg || !expectedHarvestDate || !location) {
      return res.status(400).json({
        success: false,
        error: 'cropName, totalQuantityKg, askingPricePerKg, expectedHarvestDate, and location are required'
      });
    }

    const qty = parseFloat(totalQuantityKg);
    const price = parseFloat(askingPricePerKg);

    if (isNaN(qty) || qty <= 0) {
      return res.status(400).json({
        success: false,
        error: 'totalQuantityKg must be a positive number'
      });
    }

    if (isNaN(price) || price <= 0) {
      return res.status(400).json({
        success: false,
        error: 'askingPricePerKg must be a positive number'
      });
    }

    const parsedDate = new Date(expectedHarvestDate);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'expectedHarvestDate must be a valid ISO date'
      });
    }

    // Lookup farmer profile for authenticated user
    const farmerProfile = await prisma.farmerProfile.findUnique({
      where: { userId: req.user.id }
    });

    if (!farmerProfile) {
      return res.status(403).json({
        success: false,
        error: 'Farmer profile not found for this user account'
      });
    }

    const listing = await prisma.cropListing.create({
      data: {
        farmerId: farmerProfile.id,
        cropName: cropName.trim(),
        variety: variety ? variety.trim() : null,
        totalQuantityKg: qty,
        availableQuantityKg: qty, // Starts equal to total quantity
        askingPricePerKg: price,
        suggestedMinPrice: suggestedMinPrice ? parseFloat(suggestedMinPrice) : null,
        suggestedMaxPrice: suggestedMaxPrice ? parseFloat(suggestedMaxPrice) : null,
        expectedHarvestDate: parsedDate,
        location: location.trim(),
        photoUrl: photoUrl ? photoUrl.trim() : null,
        isActive: true
      },
      include: {
        farmer: {
          select: {
            state: true,
            district: true,
            village: true,
            user: {
              select: {
                name: true,
                phoneNumber: true
              }
            }
          }
        }
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
 * GET /api/listings/mine
 * FARMER only: Fetch all listings created by the logged-in farmer (both active and inactive).
 */
const getMyListings = async (req, res) => {
  try {
    const farmerProfile = await prisma.farmerProfile.findUnique({
      where: { userId: req.user.id }
    });

    if (!farmerProfile) {
      return res.status(403).json({
        success: false,
        error: 'Farmer profile not found'
      });
    }

    const listings = await prisma.cropListing.findMany({
      where: { farmerId: farmerProfile.id },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { orders: true }
        }
      }
    });

    return res.status(200).json({
      success: true,
      count: listings.length,
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
 * GET /api/listings
 * Public: Browse active crop listings with search, price filters, state/district filters, and pagination.
 */
const getActiveListings = async (req, res) => {
  try {
    const { cropName, state, district, minPrice, maxPrice, page = 1, limit = 10 } = req.query;

    const pageNumber = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(limit, 10) || 10)); // Sane upper cap of 50
    const skip = (pageNumber - 1) * pageSize;

    // Build filter condition - only browse isActive: true
    const where = {
      isActive: true
    };

    if (cropName && cropName.trim()) {
      where.cropName = {
        contains: cropName.trim(),
        mode: 'insensitive'
      };
    }

    if (minPrice || maxPrice) {
      where.askingPricePerKg = {};
      if (minPrice) where.askingPricePerKg.gte = parseFloat(minPrice);
      if (maxPrice) where.askingPricePerKg.lte = parseFloat(maxPrice);
    }

    if (state || district) {
      where.farmer = {};
      if (state) {
        where.farmer.state = {
          contains: state.trim(),
          mode: 'insensitive'
        };
      }
      if (district) {
        where.farmer.district = {
          contains: district.trim(),
          mode: 'insensitive'
        };
      }
    }

    // Execute count and query in parallel
    const [total, listings] = await Promise.all([
      prisma.cropListing.count({ where }),
      prisma.cropListing.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' }, // Newest first
        include: {
          farmer: {
            select: {
              state: true,
              district: true,
              village: true,
              user: {
                select: {
                  name: true
                }
              }
            }
          }
        }
      })
    ]);

    return res.status(200).json({
      success: true,
      listings,
      pagination: {
        total,
        page: pageNumber,
        limit: pageSize,
        totalPages: Math.ceil(total / pageSize)
      }
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
 * GET /api/listings/:id
 * Single listing: Active listings are public. Inactive listings are visible only to the owning farmer.
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
            village: true,
            user: {
              select: {
                name: true,
                phoneNumber: true
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

    // Inactive listings are private to the creator farmer
    if (!listing.isActive) {
      let currentUserId = null;

      // Extract token if caller provided Authorization header
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const token = authHeader.split(' ')[1];
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          currentUserId = decoded.id;
        } catch (err) {
          // Token invalid/expired -> caller is treated as unauthenticated
        }
      }

      if (!currentUserId || currentUserId !== listing.farmer.userId) {
        return res.status(404).json({
          success: false,
          error: 'Listing not found'
        });
      }
    }

    return res.status(200).json({
      success: true,
      listing
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
 * PUT /api/listings/:id
 * FARMER only: Update crop listing details or toggle active status. Only the owner can update.
 */
const updateListing = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      askingPricePerKg,
      totalQuantityKg,
      availableQuantityKg,
      expectedHarvestDate,
      location,
      photoUrl,
      isActive,
      variety
    } = req.body;

    // Check existing listing and farmer ownership
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

    if (variety !== undefined) dataToUpdate.variety = variety ? variety.trim() : null;
    if (location !== undefined) dataToUpdate.location = location.trim();
    if (photoUrl !== undefined) dataToUpdate.photoUrl = photoUrl ? photoUrl.trim() : null;
    if (isActive !== undefined) dataToUpdate.isActive = Boolean(isActive);

    if (askingPricePerKg !== undefined) {
      const price = parseFloat(askingPricePerKg);
      if (isNaN(price) || price <= 0) {
        return res.status(400).json({ success: false, error: 'askingPricePerKg must be a positive number' });
      }
      dataToUpdate.askingPricePerKg = price;
    }

    if (totalQuantityKg !== undefined) {
      const qty = parseFloat(totalQuantityKg);
      if (isNaN(qty) || qty <= 0) {
        return res.status(400).json({ success: false, error: 'totalQuantityKg must be a positive number' });
      }
      dataToUpdate.totalQuantityKg = qty;
    }

    if (availableQuantityKg !== undefined) {
      const avail = parseFloat(availableQuantityKg);
      if (isNaN(avail) || avail < 0) {
        return res.status(400).json({ success: false, error: 'availableQuantityKg must be 0 or greater' });
      }
      dataToUpdate.availableQuantityKg = avail;
    }

    if (expectedHarvestDate !== undefined) {
      const date = new Date(expectedHarvestDate);
      if (isNaN(date.getTime())) {
        return res.status(400).json({ success: false, error: 'expectedHarvestDate must be a valid ISO date' });
      }
      dataToUpdate.expectedHarvestDate = date;
    }

    const updated = await prisma.cropListing.update({
      where: { id },
      data: dataToUpdate,
      include: {
        farmer: {
          select: {
            state: true,
            district: true,
            village: true,
            user: {
              select: {
                name: true
              }
            }
          }
        }
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

module.exports = {
  createListing,
  getMyListings,
  getActiveListings,
  getListingById,
  updateListing
};
