const jwt = require('jsonwebtoken');

/**
 * Middleware: requireAuth
 * Validates the JWT Bearer token from the Authorization header.
 * Attaches the decoded user payload to req.user.
 */
const requireAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Missing or malformed token. Expected format: Bearer <token>'
      });
    }

    const token = authHeader.split(' ')[1];
    
    // Strict secret verification with no insecure hardcoded fallback
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Attach decoded user info: { id, role, phoneNumber, email, name, ... }
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Token has expired'
      });
    }
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid token'
    });
  }
};

/**
 * Middleware: requireRole
 * Restricts endpoint access to specific roles (e.g. FARMER, BUYER, ADMIN).
 * Must be placed after requireAuth.
 */
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: User authentication required'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `Forbidden: Access denied. Required role: [${allowedRoles.join(', ')}], current role: ${req.user.role}`
      });
    }

    next();
  };
};

module.exports = {
  requireAuth,
  requireRole
};
