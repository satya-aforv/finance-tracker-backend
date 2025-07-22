// backend/middleware/errorHandler.js - UPDATED WITH STANDARDIZED RESPONSES
import mongoose from 'mongoose';

export const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log error with context
  const errorContext = {
    error: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    user: req.user?.id || 'anonymous',
    timestamp: new Date().toISOString()
  };
  
  console.error('Error occurred:', errorContext);

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Resource not found';
    error = { 
      message, 
      statusCode: 404,
      code: 'RESOURCE_NOT_FOUND'
    };
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const value = err.keyValue[field];
    const message = `Duplicate value for field: ${field}`;
    error = { 
      message, 
      statusCode: 400,
      code: 'DUPLICATE_FIELD',
      field,
      value
    };
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(val => ({
      field: val.path,
      message: val.message,
      value: val.value
    }));
    
    error = { 
      message: 'Validation failed',
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      errors
    };
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    const message = 'Invalid token';
    error = { 
      message, 
      statusCode: 401,
      code: 'INVALID_TOKEN'
    };
  }

  if (err.name === 'TokenExpiredError') {
    const message = 'Token expired';
    error = { 
      message, 
      statusCode: 401,
      code: 'TOKEN_EXPIRED'
    };
  }

  // Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    error = {
      message: 'File too large',
      statusCode: 400,
      code: 'FILE_TOO_LARGE',
      maxSize: process.env.MAX_FILE_SIZE || '5MB'
    };
  }

  if (err.code === 'LIMIT_FILE_COUNT') {
    error = {
      message: 'Too many files',
      statusCode: 400,
      code: 'TOO_MANY_FILES',
      maxCount: 5
    };
  }

  // Database connection errors
  if (err.name === 'MongoError' || err.name === 'MongooseError') {
    error = {
      message: 'Database operation failed',
      statusCode: 500,
      code: 'DATABASE_ERROR'
    };
  }

  // Permission errors
  if (err.message && err.message.includes('permission')) {
    error = {
      message: err.message,
      statusCode: 403,
      code: 'PERMISSION_DENIED'
    };
  }

  // Network/timeout errors
  if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
    error = {
      message: 'Service unavailable',
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE'
    };
  }

  // Send standardized error response
  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || 'Internal Server Error',
    code: error.code || 'INTERNAL_ERROR',
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    method: req.method,
    ...(error.errors && { errors: error.errors }),
    ...(error.field && { field: error.field }),
    ...(error.value && { value: error.value }),
    ...(process.env.NODE_ENV === 'development' && { 
      stack: err.stack,
      requestId: req.id
    })
  });
};

export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Standardized response helpers
export const sendSuccess = (res, statusCode = 200, message = 'Success', data = null, meta = null) => {
  const response = {
    success: true,
    message,
    timestamp: new Date().toISOString()
  };
  
  if (data !== null) response.data = data;
  if (meta) response.meta = meta;
  
  return res.status(statusCode).json(response);
};

export const sendError = (res, statusCode = 500, message = 'Internal Server Error', code = 'INTERNAL_ERROR', errors = null) => {
  const response = {
    success: false,
    message,
    code,
    timestamp: new Date().toISOString()
  };
  
  if (errors) response.errors = errors;
  
  return res.status(statusCode).json(response);
};

export const sendValidationError = (res, errors) => {
  return sendError(res, 400, 'Validation failed', 'VALIDATION_ERROR', errors);
};

export const sendNotFound = (res, resource = 'Resource') => {
  return sendError(res, 404, `${resource} not found`, 'RESOURCE_NOT_FOUND');
};

export const sendUnauthorized = (res, message = 'Unauthorized access') => {
  return sendError(res, 401, message, 'UNAUTHORIZED');
};

export const sendForbidden = (res, message = 'Access forbidden') => {
  return sendError(res, 403, message, 'FORBIDDEN');
};

export const sendConflict = (res, message = 'Resource conflict') => {
  return sendError(res, 409, message, 'CONFLICT');
};

export const sendCreated = (res, message = 'Resource created successfully', data = null) => {
  return sendSuccess(res, 201, message, data);
};

export const sendUpdated = (res, message = 'Resource updated successfully', data = null) => {
  return sendSuccess(res, 200, message, data);
};

export const sendDeleted = (res, message = 'Resource deleted successfully') => {
  return sendSuccess(res, 200, message);
};

// Custom error classes
export class AppError extends Error {
  constructor(message, statusCode, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', errors = []) {
    super(message, 400, 'VALIDATION_ERROR');
    this.errors = errors;
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'RESOURCE_NOT_FOUND');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized access') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409, 'CONFLICT');
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable') {
    super(message, 503, 'SERVICE_UNAVAILABLE');
  }
}

// Request ID middleware for tracking
export const requestId = (req, res, next) => {
  req.id = Math.random().toString(36).substr(2, 9);
  res.setHeader('X-Request-ID', req.id);
  next();
};

// 404 handler for unmatched routes
export const notFoundHandler = (req, res, next) => {
  const error = new NotFoundError(`Route ${req.originalUrl} not found`);
  next(error);
};

// Global uncaught exception handler
export const uncaughtExceptionHandler = (err) => {
  console.error('UNCAUGHT EXCEPTION! 💥 Shutting down...');
  console.error('Error:', err.name, err.message);
  console.error('Stack:', err.stack);
  
  process.exit(1);
};

// Global unhandled rejection handler
export const unhandledRejectionHandler = (err) => {
  console.error('UNHANDLED REJECTION! 💥 Shutting down...');
  console.error('Error:', err.name, err.message);
  
  // Give the server time to finish any pending requests
  setTimeout(() => {
    process.exit(1);
  }, 1000);
};