import express from 'express';
import { body, validationResult } from 'express-validator';
import Settings from '../models/Settings.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { uploadSingle, handleUploadError } from '../middleware/upload.js';

const router = express.Router();

// @route   GET /api/settings
// @desc    Get system settings
// @access  Private
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const settings = await Settings.getSingleton();
  
  res.json({
    success: true,
    data: settings
  });
}));

// @route   PUT /api/settings
// @desc    Update system settings
// @access  Private (Admin only)
router.put('/', authenticate, authorize('admin'), [
  body('company.name').optional().trim().notEmpty().withMessage('Company name cannot be empty'),
  body('company.email').optional().isEmail().withMessage('Please enter a valid email'),
  body('company.phone').optional().trim().notEmpty().withMessage('Phone cannot be empty'),
  body('financial.defaultCurrency').optional().isIn(['INR', 'USD', 'EUR']),
  body('financial.financialYearStart').optional().isIn(['January', 'April', 'July', 'October']),
  body('financial.defaultLateFee').optional().isFloat({ min: 0, max: 10 }),
  body('financial.gracePeriodDays').optional().isInt({ min: 0, max: 30 }),
  body('notifications.paymentReminders.daysBefore').optional().isInt({ min: 1, max: 30 }),
  body('notifications.overdueAlerts.frequency').optional().isIn(['daily', 'weekly', 'monthly']),
  body('notifications.investmentMaturity.daysBefore').optional().isInt({ min: 1, max: 90 }),
  body('security.passwordPolicy.minLength').optional().isInt({ min: 6, max: 20 }),
  body('security.sessionTimeout').optional().isInt({ min: 15, max: 480 }),
  body('security.maxLoginAttempts').optional().isInt({ min: 3, max: 10 }),
  body('backup.frequency').optional().isIn(['daily', 'weekly', 'monthly']),
  body('backup.retentionDays').optional().isInt({ min: 7, max: 365 })
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: 'Validation failed', 
      errors: errors.array() 
    });
  }

  let settings = await Settings.getSingleton();
  
  // Update settings with new data
  Object.assign(settings, req.body);
  settings.updatedBy = req.user._id;
  
  await settings.save();

  res.json({
    success: true,
    message: 'Settings updated successfully',
    data: settings
  });
}));

// @route   POST /api/settings/logo
// @desc    Upload company logo
// @access  Private (Admin only)
router.post('/logo', 
  authenticate, 
  authorize('admin'),
  uploadSingle('logo'),
  handleUploadError,
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ message: 'No logo file uploaded' });
    }

    const settings = await Settings.getSingleton();
    settings.company.logo = req.file.path;
    settings.updatedBy = req.user._id;
    
    await settings.save();

    res.json({
      success: true,
      message: 'Logo uploaded successfully',
      data: {
        logo: settings.company.logo
      }
    });
  })
);

export default router;