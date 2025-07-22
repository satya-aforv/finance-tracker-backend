// backend/middleware/auth.js - UPDATED WITH ENHANCED AUTHORIZATION
import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export const authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ 
        success: false,
        message: 'No token provided, access denied',
        code: 'NO_TOKEN'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user) {
      return res.status(401).json({ 
        success: false,
        message: 'Token is not valid',
        code: 'INVALID_TOKEN'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({ 
        success: false,
        message: 'Account is deactivated',
        code: 'ACCOUNT_DEACTIVATED'
      });
    }

    // Check if user is locked
    if (user.isLocked()) {
      return res.status(401).json({ 
        success: false,
        message: 'Account is temporarily locked due to too many failed login attempts',
        code: 'ACCOUNT_LOCKED'
      });
    }

    // Check if password was changed after token was issued
    if (user.changedPasswordAfter(decoded.iat)) {
      return res.status(401).json({ 
        success: false,
        message: 'Password was recently changed. Please log in again.',
        code: 'PASSWORD_CHANGED'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false,
        message: 'Token has expired',
        code: 'TOKEN_EXPIRED'
      });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        success: false,
        message: 'Invalid token',
        code: 'INVALID_TOKEN'
      });
    }
    return res.status(401).json({ 
      success: false,
      message: 'Authentication failed',
      code: 'AUTH_FAILED'
    });
  }
};

export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        success: false,
        message: 'Access denied. Please authenticate first.',
        code: 'NOT_AUTHENTICATED'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        success: false,
        message: 'Access denied. Insufficient permissions.',
        code: 'INSUFFICIENT_PERMISSIONS',
        requiredRoles: roles,
        userRole: req.user.role
      });
    }

    next();
  };
};

export const authorizeResource = (resource) => {
  return async (req, res, next) => {
    try {
      if (req.user.role === 'admin') {
        return next(); // Admin can access everything
      }
      
      if (req.user.role === 'investor') {
        // Investors can only access their own resources
        const resourceId = req.params.id;
        
        switch (resource) {
          case 'investment':
            const { default: Investment } = await import('../models/Investment.js');
            const { default: Investor } = await import('../models/Investor.js');
            
            const investor = await Investor.findOne({ userId: req.user._id });
            if (!investor) {
              return res.status(403).json({ 
                success: false,
                message: 'No investor profile found for this user',
                code: 'NO_INVESTOR_PROFILE'
              });
            }
            
            const investment = await Investment.findById(resourceId);
            if (!investment || investment.investor.toString() !== investor._id.toString()) {
              return res.status(403).json({ 
                success: false,
                message: 'Access denied to this investment',
                code: 'RESOURCE_ACCESS_DENIED'
              });
            }
            break;
            
          case 'payment':
            const { default: Payment } = await import('../models/Payment.js');
            const { default: InvestorModel } = await import('../models/Investor.js');
            
            const investorForPayment = await InvestorModel.findOne({ userId: req.user._id });
            if (!investorForPayment) {
              return res.status(403).json({ 
                success: false,
                message: 'No investor profile found',
                code: 'NO_INVESTOR_PROFILE'
              });
            }
            
            const payment = await Payment.findById(resourceId);
            if (!payment || payment.investor.toString() !== investorForPayment._id.toString()) {
              return res.status(403).json({ 
                success: false,
                message: 'Access denied to this payment',
                code: 'RESOURCE_ACCESS_DENIED'
              });
            }
            break;
            
          case 'investor':
            const { default: InvestorForProfile } = await import('../models/Investor.js');
            
            const investorProfile = await InvestorForProfile.findById(resourceId);
            if (!investorProfile || investorProfile.userId?.toString() !== req.user._id.toString()) {
              return res.status(403).json({ 
                success: false,
                message: 'Access denied to this investor profile',
                code: 'RESOURCE_ACCESS_DENIED'
              });
            }
            break;
            
          default:
            return res.status(403).json({ 
              success: false,
              message: 'Access denied',
              code: 'RESOURCE_ACCESS_DENIED'
            });
        }
      }
      
      next();
    } catch (error) {
      console.error('Authorization check error:', error);
      return res.status(500).json({ 
        success: false,
        message: 'Authorization check failed',
        code: 'AUTH_CHECK_FAILED'
      });
    }
  };
};

export const optionalAuth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId).select('-password');
      
      if (user && user.isActive && !user.isLocked() && !user.changedPasswordAfter(decoded.iat)) {
        req.user = user;
      }
    }
    
    next();
  } catch (error) {
    // Continue without authentication for optional auth
    next();
  }
};

// Rate limiting for authentication attempts
export const authRateLimit = (maxAttempts = 5, windowMs = 15 * 60 * 1000) => {
  const attempts = new Map();
  
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    
    if (!attempts.has(ip)) {
      attempts.set(ip, { count: 1, resetTime: now + windowMs });
      return next();
    }
    
    const attempt = attempts.get(ip);
    
    if (now > attempt.resetTime) {
      attempts.set(ip, { count: 1, resetTime: now + windowMs });
      return next();
    }
    
    if (attempt.count >= maxAttempts) {
      return res.status(429).json({
        success: false,
        message: 'Too many authentication attempts. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil((attempt.resetTime - now) / 1000)
      });
    }
    
    attempt.count++;
    next();
  };
};

// Admin only middleware
export const adminOnly = authorize('admin');

// Finance manager or admin middleware
export const financeManagerOrAdmin = authorize('admin', 'finance_manager');

// Investor only middleware
export const investorOnly = authorize('investor');

// Check if user owns the resource or is admin/finance_manager
export const ownerOrManager = (resourceType) => {
  return async (req, res, next) => {
    if (req.user.role === 'admin' || req.user.role === 'finance_manager') {
      return next();
    }
    
    return authorizeResource(resourceType)(req, res, next);
  };
};

// Middleware to log authentication events
export const logAuthEvent = (eventType) => {
  return (req, res, next) => {
    const logData = {
      eventType,
      userId: req.user?.id,
      userRole: req.user?.role,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date(),
      endpoint: req.originalUrl,
      method: req.method
    };
    
    console.log('Auth Event:', logData);
    
    // In production, you might want to send this to a logging service
    // logger.info('Authentication event', logData);
    
    next();
  };
};

// Check if user has specific permission
export const hasPermission = (permission) => {
  const rolePermissions = {
    admin: ['*'], // Admin has all permissions
    finance_manager: [
      'investors:read',
      'investors:write',
      'investments:read',
      'investments:write',
      'payments:read',
      'payments:write',
      'plans:read',
      'plans:write',
      'reports:read'
    ],
    investor: [
      'investments:read:own',
      'payments:read:own',
      'profile:read:own',
      'profile:write:own'
    ]
  };
  
  return (req, res, next) => {
    const userPermissions = rolePermissions[req.user.role] || [];
    
    if (userPermissions.includes('*') || userPermissions.includes(permission)) {
      return next();
    }
    
    return res.status(403).json({
      success: false,
      message: `Permission denied. Required permission: ${permission}`,
      code: 'PERMISSION_DENIED',
      requiredPermission: permission,
      userRole: req.user.role
    });
  };
};