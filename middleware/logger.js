// backend/middleware/logger.js - SIMPLIFIED VERSION (No Extra Dependencies)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Simple console colors for development
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

class SimpleLogger {
  constructor() {
    this.logFile = path.join(logsDir, 'app.log');
    this.errorFile = path.join(logsDir, 'error.log');
  }

  formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...meta
    };
    return JSON.stringify(logEntry) + '\n';
  }

  writeToFile(filename, data) {
    try {
      fs.appendFileSync(filename, data);
    } catch (error) {
      console.error('Failed to write to log file:', error.message);
    }
  }

  colorize(text, color) {
    if (process.env.NODE_ENV === 'production') return text;
    return `${colors[color]}${text}${colors.reset}`;
  }

  log(level, message, meta = {}) {
    const formattedMessage = this.formatMessage(level, message, meta);
    
    // Write to files
    this.writeToFile(this.logFile, formattedMessage);
    if (level === 'ERROR') {
      this.writeToFile(this.errorFile, formattedMessage);
    }

    // Console output in development
    if (process.env.NODE_ENV !== 'production') {
      const timestamp = this.colorize(new Date().toISOString(), 'cyan');
      const levelColors = {
        ERROR: 'red',
        WARN: 'yellow',
        INFO: 'green',
        DEBUG: 'blue'
      };
      const levelColored = this.colorize(`[${level}]`, levelColors[level]);
      
      console.log(`${timestamp} ${levelColored} ${message}`, 
        Object.keys(meta).length > 0 ? meta : '');
    }
  }

  error(message, meta = {}) {
    this.log('ERROR', message, meta);
  }

  warn(message, meta = {}) {
    this.log('WARN', message, meta);
  }

  info(message, meta = {}) {
    this.log('INFO', message, meta);
  }

  debug(message, meta = {}) {
    if (process.env.NODE_ENV === 'development') {
      this.log('DEBUG', message, meta);
    }
  }
}

// Create singleton logger instance
const logger = new SimpleLogger();

// Request logging middleware
export const requestLogger = (req, res, next) => {
  const start = Date.now();
  const requestId = Math.random().toString(36).substr(2, 9);
  
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);

  // Log request start
  logger.info('Request started', {
    requestId,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id
  });

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - start;
    
    const logData = {
      requestId,
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userId: req.user?.id
    };

    if (res.statusCode >= 500) {
      logger.error('Request failed', logData);
    } else if (res.statusCode >= 400) {
      logger.warn('Client error', logData);
    } else {
      logger.info('Request completed', logData);
    }
  });

  next();
};

// Authentication event logger
export const authLogger = (eventType, userId, details = {}) => {
  logger.info('Auth event', {
    eventType,
    userId,
    ...details
  });
};

// Error logger
export const errorLogger = (error, context = {}) => {
  logger.error('Application error', {
    message: error.message,
    stack: error.stack,
    ...context
  });
};

// Business event logger
export const businessLogger = (event, details = {}) => {
  logger.info('Business event', {
    event,
    ...details
  });
};

// Validation error logger
export const validationLogger = (req, res, next) => {
  const originalJson = res.json;
  
  res.json = function(data) {
    if (data && !data.success && data.code === 'VALIDATION_ERROR') {
      logger.warn('Validation failed', {
        requestId: req.requestId,
        url: req.originalUrl,
        method: req.method,
        errors: data.errors
      });
    }
    originalJson.call(this, data);
  };
  
  next();
};

export default logger;
export { logger };