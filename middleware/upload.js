// backend/middleware/upload.js - UPDATED WITH ENHANCED VALIDATION
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// File type configurations
const FILE_CONFIGS = {
  documents: {
    allowedTypes: ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png'],
    maxSize: 10 * 1024 * 1024, // 10MB
    mimeTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/jpg',
      'image/png'
    ]
  },
  avatars: {
    allowedTypes: ['.jpg', '.jpeg', '.png', '.gif'],
    maxSize: 2 * 1024 * 1024, // 2MB
    mimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif']
  },
  receipts: {
    allowedTypes: ['.pdf', '.jpg', '.jpeg', '.png'],
    maxSize: 5 * 1024 * 1024, // 5MB
    mimeTypes: ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png']
  },
  agreements: {
    allowedTypes: ['.pdf', '.doc', '.docx'],
    maxSize: 10 * 1024 * 1024, // 10MB
    mimeTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
  },
  company: {
    allowedTypes: ['.jpg', '.jpeg', '.png', '.svg'],
    maxSize: 5 * 1024 * 1024, // 5MB
    mimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/svg+xml']
  }
};

// Ensure upload directories exist
const uploadPaths = {
  documents: path.join(__dirname, '../uploads/documents'),
  avatars: path.join(__dirname, '../uploads/avatars'),
  receipts: path.join(__dirname, '../uploads/receipts'),
  agreements: path.join(__dirname, '../uploads/agreements'),
  company: path.join(__dirname, '../uploads/company'),
  temp: path.join(__dirname, '../uploads/temp')
};

// Create directories if they don't exist
Object.values(uploadPaths).forEach(uploadPath => {
  if (!fs.existsSync(uploadPath)) {
    fs.mkdirSync(uploadPath, { recursive: true });
    console.log(`Created upload directory: ${uploadPath}`);
  }
});

// Helper function to determine upload type from fieldname
const getUploadTypeFromFieldname = (fieldname) => {
  const typeMap = {
    'documents': 'documents',
    'document': 'documents',
    'avatar': 'avatars',
    'profileImage': 'avatars',
    'receipt': 'receipts',
    'agreement': 'agreements',
    'logo': 'company',
    'company': 'company'
  };
  
  return typeMap[fieldname] || 'documents';
};

// Generate secure filename
const generateSecureFilename = (originalname, fieldname) => {
  const timestamp = Date.now();
  const randomString = crypto.randomBytes(8).toString('hex');
  const ext = path.extname(originalname).toLowerCase();
  const sanitizedName = path.basename(originalname, ext)
    .replace(/[^a-zA-Z0-9]/g, '_')
    .substring(0, 50);
  
  return `${fieldname}_${timestamp}_${randomString}_${sanitizedName}${ext}`;
};

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = getUploadTypeFromFieldname(file.fieldname);
    const uploadPath = uploadPaths[type];
    
    if (!uploadPath) {
      return cb(new Error(`Invalid upload type: ${type}`), null);
    }
    
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    try {
      const secureFilename = generateSecureFilename(file.originalname, file.fieldname);
      cb(null, secureFilename);
    } catch (error) {
      cb(error, null);
    }
  }
});

// Enhanced file filter with security checks
const fileFilter = (req, file, cb) => {
  try {
    const type = getUploadTypeFromFieldname(file.fieldname);
    const config = FILE_CONFIGS[type];
    
    if (!config) {
      return cb(new Error(`Invalid upload type: ${type}`), false);
    }
    
    const ext = path.extname(file.originalname).toLowerCase();
    
    // Check file extension
    if (!config.allowedTypes.includes(ext)) {
      return cb(new Error(
        `Invalid file type for ${type}. Allowed types: ${config.allowedTypes.join(', ')}`
      ), false);
    }
    
    // Check MIME type
    if (!config.mimeTypes.includes(file.mimetype)) {
      return cb(new Error(
        `Invalid MIME type: ${file.mimetype}. Expected one of: ${config.mimeTypes.join(', ')}`
      ), false);
    }
    
    // Additional security checks
    if (file.originalname.includes('..') || file.originalname.includes('/')) {
      return cb(new Error('Invalid filename characters detected'), false);
    }
    
    // Check for suspicious file patterns
    const suspiciousPatterns = ['.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs', '.js'];
    const hasSuspiciousPattern = suspiciousPatterns.some(pattern => 
      file.originalname.toLowerCase().includes(pattern)
    );
    
    if (hasSuspiciousPattern) {
      return cb(new Error('File type not allowed for security reasons'), false);
    }
    
    cb(null, true);
  } catch (error) {
    cb(error, false);
  }
};

// Get max file size for specific field
const getMaxFileSize = (fieldname) => {
  const type = getUploadTypeFromFieldname(fieldname);
  return FILE_CONFIGS[type]?.maxSize || 5 * 1024 * 1024; // Default 5MB
};

// Configure multer with enhanced options
const createUploadInstance = (fieldname) => {
  return multer({
    storage,
    fileFilter,
    limits: {
      fileSize: getMaxFileSize(fieldname),
      files: 10, // Maximum 10 files per request
      fields: 20, // Maximum 20 non-file fields
      fieldNameSize: 100, // Maximum field name size
      fieldSize: 1 * 1024 * 1024 // Maximum field value size (1MB)
    }
  });
};

// Export different upload configurations
export const uploadSingle = (fieldName) => {
  const upload = createUploadInstance(fieldName);
  return upload.single(fieldName);
};

export const uploadMultiple = (fieldName, maxCount = 5) => {
  const upload = createUploadInstance(fieldName);
  return upload.array(fieldName, maxCount);
};

export const uploadFields = (fields) => {
  const upload = multer({
    storage,
    fileFilter,
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB for mixed uploads
      files: 15,
      fields: 30
    }
  });
  return upload.fields(fields);
};

// Enhanced error handling middleware for multer
export const handleUploadError = (err, req, res, next) => {
  console.error('Upload error:', {
    error: err.message,
    code: err.code,
    field: err.field,
    file: req.file?.originalname,
    files: req.files?.map(f => f.originalname),
    timestamp: new Date().toISOString()
  });
  
  if (err instanceof multer.MulterError) {
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        const maxSize = getMaxFileSize(err.field || 'default');
        return res.status(400).json({ 
          success: false,
          message: `File too large. Maximum size allowed is ${Math.round(maxSize / (1024 * 1024))}MB.`,
          code: 'FILE_TOO_LARGE',
          maxSize: maxSize,
          field: err.field
        });
        
      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({ 
          success: false,
          message: 'Too many files. Maximum 10 files allowed per request.',
          code: 'TOO_MANY_FILES',
          maxCount: 10
        });
        
      case 'LIMIT_FIELD_COUNT':
        return res.status(400).json({ 
          success: false,
          message: 'Too many fields in the request.',
          code: 'TOO_MANY_FIELDS'
        });
        
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({ 
          success: false,
          message: `Unexpected field: ${err.field}. Please check the field name.`,
          code: 'UNEXPECTED_FIELD',
          field: err.field
        });
        
      case 'LIMIT_PART_COUNT':
        return res.status(400).json({ 
          success: false,
          message: 'Too many parts in the multipart request.',
          code: 'TOO_MANY_PARTS'
        });
        
      case 'LIMIT_FILE_NAME_SIZE':
        return res.status(400).json({ 
          success: false,
          message: 'Filename too long.',
          code: 'FILENAME_TOO_LONG'
        });
        
      case 'LIMIT_FIELD_NAME_SIZE':
        return res.status(400).json({ 
          success: false,
          message: 'Field name too long.',
          code: 'FIELDNAME_TOO_LONG'
        });
        
      case 'LIMIT_FIELD_VALUE_SIZE':
        return res.status(400).json({ 
          success: false,
          message: 'Field value too large.',
          code: 'FIELD_VALUE_TOO_LARGE'
        });
        
      default:
        return res.status(400).json({ 
          success: false,
          message: `Upload error: ${err.message}`,
          code: 'UPLOAD_ERROR'
        });
    }
  }
  
  // Custom validation errors
  if (err && err.message && err.message.includes('Invalid file type')) {
    return res.status(400).json({ 
      success: false,
      message: err.message,
      code: 'INVALID_FILE_TYPE'
    });
  }
  
  if (err && err.message && err.message.includes('Invalid MIME type')) {
    return res.status(400).json({ 
      success: false,
      message: err.message,
      code: 'INVALID_MIME_TYPE'
    });
  }
  
  if (err && err.message && err.message.includes('security')) {
    return res.status(400).json({ 
      success: false,
      message: err.message,
      code: 'SECURITY_VIOLATION'
    });
  }
  
  // Generic upload error
  if (err) {
    return res.status(500).json({
      success: false,
      message: 'File upload failed',
      code: 'UPLOAD_FAILED',
      ...(process.env.NODE_ENV === 'development' && { 
        details: err.message 
      })
    });
  }
  
  next();
};

// Middleware to validate uploaded files
export const validateUploadedFiles = (req, res, next) => {
  try {
    const files = req.files || (req.file ? [req.file] : []);
    
    if (files.length === 0 && req.method === 'POST') {
      return res.status(400).json({
        success: false,
        message: 'No files were uploaded',
        code: 'NO_FILES_UPLOADED'
      });
    }
    
    // Additional validation for each file
    for (const file of files) {
      // Check if file actually exists
      if (!fs.existsSync(file.path)) {
        return res.status(500).json({
          success: false,
          message: 'Uploaded file not found on server',
          code: 'FILE_NOT_FOUND'
        });
      }
      
      // Verify file size matches what was reported
      const stats = fs.statSync(file.path);
      if (stats.size !== file.size) {
        // Clean up the file
        fs.unlinkSync(file.path);
        return res.status(400).json({
          success: false,
          message: 'File size mismatch detected',
          code: 'FILE_SIZE_MISMATCH'
        });
      }
    }
    
    next();
  } catch (error) {
    console.error('File validation error:', error);
    return res.status(500).json({
      success: false,
      message: 'File validation failed',
      code: 'VALIDATION_FAILED'
    });
  }
};

// Utility function to clean up uploaded files in case of error
export const cleanupUploadedFiles = (files) => {
  const filesToClean = Array.isArray(files) ? files : (files ? [files] : []);
  
  filesToClean.forEach(file => {
    try {
      if (file.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
        console.log(`Cleaned up file: ${file.path}`);
      }
    } catch (error) {
      console.error(`Failed to cleanup file ${file.path}:`, error.message);
    }
  });
};

// Middleware to auto-cleanup files on error
export const autoCleanupOnError = (err, req, res, next) => {
  if (err && (req.file || req.files)) {
    const files = req.files || (req.file ? [req.file] : []);
    cleanupUploadedFiles(files);
  }
  next(err);
};

// Get file information utility
export const getFileInfo = (file) => {
  return {
    originalName: file.originalname,
    fileName: file.filename,
    path: file.path,
    size: file.size,
    mimeType: file.mimetype,
    fieldName: file.fieldname,
    encoding: file.encoding,
    uploadDate: new Date()
  };
};

// Validate file type utility
export const isValidFileType = (filename, allowedTypes) => {
  const ext = path.extname(filename).toLowerCase();
  return allowedTypes.includes(ext);
};

// Get human readable file size
export const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export default {
  uploadSingle,
  uploadMultiple,
  uploadFields,
  handleUploadError,
  validateUploadedFiles,
  cleanupUploadedFiles,
  autoCleanupOnError,
  getFileInfo,
  isValidFileType,
  formatFileSize,
  FILE_CONFIGS
};