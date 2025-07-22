// backend/routes/investors.js - Enhanced with User Account Creation
import express from 'express';
import { body, validationResult, query } from 'express-validator';
import Investor from '../models/Investor.js';
import User from '../models/User.js';
import Investment from '../models/Investment.js';
import Payment from '../models/Payment.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { uploadMultiple, handleUploadError } from '../middleware/upload.js';
import emailService from '../services/emailService.js';

const router = express.Router();

// @route   GET /api/investors
// @desc    Get all investors with pagination and search
// @access  Private (Admin, Finance Manager)
router.get('/', authenticate, authorize('admin', 'finance_manager'), [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('search').optional().trim(),
  query('status').optional().isIn(['active', 'inactive', 'blocked'])
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: 'Validation failed', 
      errors: errors.array() 
    });
  }

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;
  const search = req.query.search;
  const status = req.query.status;

  // Build query
  let query = {};
  
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { investorId: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } }
    ];
  }

  if (status) {
    query.status = status;
  }

  const [investors, total] = await Promise.all([
    Investor.find(query)
      .populate('createdBy', 'name email')
      .populate('userId', 'name email isActive lastLogin') // Populate user info
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Investor.countDocuments(query)
  ]);

  res.json({
    success: true,
    data: investors,
    pagination: {
      current: page,
      pages: Math.ceil(total / limit),
      total,
      limit
    }
  });
}));

// @route   GET /api/investors/:id
// @desc    Get single investor
// @access  Private (Admin, Finance Manager)
router.get('/:id', authenticate, authorize('admin', 'finance_manager'), asyncHandler(async (req, res) => {
  const investor = await Investor.findById(req.params.id)
    .populate('createdBy', 'name email')
    .populate('userId', 'name email isActive lastLogin role');

  if (!investor) {
    return res.status(404).json({ message: 'Investor not found' });
  }

  // Get investments and payments summary
  const [investments, totalPayments] = await Promise.all([
    Investment.find({ investor: investor._id })
      .populate('plan', 'name interestRate')
      .sort({ createdAt: -1 }),
    Payment.aggregate([
      { $match: { investor: investor._id } },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: '$amount' },
          totalInterest: { $sum: '$interestAmount' },
          totalPrincipal: { $sum: '$principalAmount' },
          count: { $sum: 1 }
        }
      }
    ])
  ]);

  res.json({
    success: true,
    data: {
      ...investor.toObject(),
      investments,
      paymentSummary: totalPayments[0] || {
        totalAmount: 0,
        totalInterest: 0,
        totalPrincipal: 0,
        count: 0
      }
    }
  });
}));

// @route   POST /api/investors
// @desc    Create new investor with optional user account
// @access  Private (Admin, Finance Manager)
router.post('/', authenticate, authorize('admin', 'finance_manager'), [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Please enter a valid email'),
  body('phone').matches(/^[6-9]\d{9}$/).withMessage('Please enter a valid 10-digit phone number'),
  body('address.street').optional().trim(),
  body('address.city').optional().trim(),
  body('address.state').optional().trim(),
  body('address.pincode').optional().matches(/^\d{6}$/).withMessage('Please enter a valid 6-digit pincode'),
  body('kyc.panNumber').matches(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/).withMessage('Please enter a valid PAN number'),
  body('kyc.aadharNumber').matches(/^\d{12}$/).withMessage('Please enter a valid 12-digit Aadhar number'),
  body('kyc.bankDetails.accountNumber').notEmpty().withMessage('Account number is required'),
  body('kyc.bankDetails.ifscCode').matches(/^[A-Z]{4}0[A-Z0-9]{6}$/).withMessage('Please enter a valid IFSC code'),
  body('kyc.bankDetails.bankName').notEmpty().withMessage('Bank name is required'),
  body('kyc.bankDetails.branchName').notEmpty().withMessage('Branch name is required'),
  // NEW: User account creation validation
  body('createUserAccount').optional().isBoolean(),
  body('userAccountDetails.password').optional().isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('userAccountDetails.confirmPassword').optional().custom((value, { req }) => {
    if (req.body.createUserAccount && value !== req.body.userAccountDetails?.password) {
      throw new Error('Passwords do not match');
    }
    return true;
  }),
  body('userAccountDetails.sendCredentials').optional().isBoolean(),
  body('userAccountDetails.temporaryPassword').optional().isBoolean()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: 'Validation failed', 
      errors: errors.array() 
    });
  }

  const { 
    name, 
    email, 
    phone, 
    address, 
    kyc, 
    createUserAccount, 
    userAccountDetails 
  } = req.body;

  // Check if investor already exists
  const existingInvestor = await Investor.findOne({
    $or: [
      { email },
      { 'kyc.panNumber': kyc.panNumber },
      { 'kyc.aadharNumber': kyc.aadharNumber }
    ]
  });

  if (existingInvestor) {
    return res.status(400).json({ 
      message: 'Investor already exists with this email, PAN, or Aadhar number' 
    });
  }

  // Check if user with email already exists (if creating user account)
  let userId = null;
  let userCredentials = null;

  if (createUserAccount) {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        message: 'A user account with this email already exists'
      });
    }

    // Create user account
    try {
      const newUser = await User.create({
        name,
        email,
        password: userAccountDetails.password,
        role: 'investor',
        phone
      });

      userId = newUser._id;
      
      // Store credentials for email (if needed)
      if (userAccountDetails.sendCredentials) {
        userCredentials = {
          email,
          password: userAccountDetails.password,
          isTemporary: userAccountDetails.temporaryPassword || false
        };
      }

      console.log(`User account created for investor: ${email}`);
    } catch (userError) {
      console.error('Failed to create user account:', userError);
      return res.status(500).json({
        message: 'Failed to create user account',
        error: userError.message
      });
    }
  }

  // Create investor
  try {
    const investor = await Investor.create({
      name,
      email,
      phone,
      address,
      kyc,
      userId, // Link to user account if created
      createdBy: req.user._id
    });

    await investor.populate('createdBy', 'name email');

    // Send welcome email if user account was created and email should be sent
    if (createUserAccount && userCredentials && userAccountDetails.sendCredentials) {
      try {
        const emailResult = await emailService.sendWelcomeEmail(investor, userCredentials);
        console.log('Email result:', emailResult);
      } catch (emailError) {
        console.error('Failed to send welcome email:', emailError);
        // Don't fail the entire operation due to email failure
      }
    }

    res.status(201).json({
      success: true,
      message: createUserAccount 
        ? 'Investor and user account created successfully' 
        : 'Investor created successfully',
      data: {
        investor,
        userAccountCreated: !!createUserAccount,
        emailSent: !!(createUserAccount && userAccountDetails.sendCredentials)
      }
    });
  } catch (investorError) {
    // If investor creation fails but user was created, clean up the user
    if (userId) {
      try {
        await User.findByIdAndDelete(userId);
        console.log('Cleaned up user account after investor creation failure');
      } catch (cleanupError) {
        console.error('Failed to cleanup user account:', cleanupError);
      }
    }
    
    throw investorError;
  }
}));

// @route   PUT /api/investors/:id
// @desc    Update investor
// @access  Private (Admin, Finance Manager)
router.put('/:id', authenticate, authorize('admin', 'finance_manager'), [
  body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
  body('email').optional().isEmail().normalizeEmail().withMessage('Please enter a valid email'),
  body('phone').optional().matches(/^[6-9]\d{9}$/).withMessage('Please enter a valid 10-digit phone number'),
  body('status').optional().isIn(['active', 'inactive', 'blocked'])
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: 'Validation failed', 
      errors: errors.array() 
    });
  }

  const investor = await Investor.findById(req.params.id).populate('userId');
  if (!investor) {
    return res.status(404).json({ message: 'Investor not found' });
  }

  // Check for conflicts if email, PAN, or Aadhar is being updated
  const { email, kyc } = req.body;
  if (email || kyc) {
    const conflicts = {};
    if (email && email !== investor.email) conflicts.email = email;
    if (kyc?.panNumber && kyc.panNumber !== investor.kyc.panNumber) {
      conflicts['kyc.panNumber'] = kyc.panNumber;
    }
    if (kyc?.aadharNumber && kyc.aadharNumber !== investor.kyc.aadharNumber) {
      conflicts['kyc.aadharNumber'] = kyc.aadharNumber;
    }

    if (Object.keys(conflicts).length > 0) {
      const existingInvestor = await Investor.findOne({
        _id: { $ne: investor._id },
        $or: Object.entries(conflicts).map(([key, value]) => ({ [key]: value }))
      });

      if (existingInvestor) {
        return res.status(400).json({ 
          message: 'Another investor already exists with this email, PAN, or Aadhar number' 
        });
      }
    }
  }

  // Update linked user account if exists and email is being changed
  if (investor.userId && email && email !== investor.email) {
    try {
      await User.findByIdAndUpdate(investor.userId, { email });
      console.log(`Updated user email for investor ${investor.investorId}`);
    } catch (userUpdateError) {
      console.error('Failed to update user email:', userUpdateError);
      return res.status(500).json({
        message: 'Failed to update linked user account'
      });
    }
  }

  // Update investor status and linked user status
  if (req.body.status && investor.userId) {
    const userIsActive = req.body.status === 'active';
    try {
      await User.findByIdAndUpdate(investor.userId, { isActive: userIsActive });
      console.log(`Updated user status for investor ${investor.investorId}: ${userIsActive}`);
    } catch (userStatusError) {
      console.error('Failed to update user status:', userStatusError);
    }
  }

  // Update investor
  Object.assign(investor, req.body);
  await investor.save();
  await investor.populate('createdBy', 'name email');

  res.json({
    success: true,
    message: 'Investor updated successfully',
    data: investor
  });
}));

// @route   DELETE /api/investors/:id
// @desc    Delete investor
// @access  Private (Admin only)
router.delete('/:id', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const investor = await Investor.findById(req.params.id).populate('userId');
  if (!investor) {
    return res.status(404).json({ message: 'Investor not found' });
  }

  // Check if investor has active investments
  const activeInvestments = await Investment.countDocuments({
    investor: investor._id,
    status: 'active'
  });

  if (activeInvestments > 0) {
    return res.status(400).json({ 
      message: 'Cannot delete investor with active investments' 
    });
  }

  // Delete linked user account if exists
  if (investor.userId) {
    try {
      await User.findByIdAndDelete(investor.userId);
      console.log(`Deleted user account for investor ${investor.investorId}`);
    } catch (userDeleteError) {
      console.error('Failed to delete user account:', userDeleteError);
      // Continue with investor deletion even if user deletion fails
    }
  }

  await investor.deleteOne();

  res.json({
    success: true,
    message: 'Investor and associated user account deleted successfully'
  });
}));

// NEW: @route   POST /api/investors/:id/create-user-account
// @desc    Create user account for existing investor
// @access  Private (Admin, Finance Manager)
router.post('/:id/create-user-account', authenticate, authorize('admin', 'finance_manager'), [
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('sendCredentials').optional().isBoolean(),
  body('temporaryPassword').optional().isBoolean()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: 'Validation failed', 
      errors: errors.array() 
    });
  }

  const investor = await Investor.findById(req.params.id);
  if (!investor) {
    return res.status(404).json({ message: 'Investor not found' });
  }

  if (investor.userId) {
    return res.status(400).json({ 
      message: 'User account already exists for this investor' 
    });
  }

  const { password, sendCredentials = false, temporaryPassword = false } = req.body;

  // Check if user with email already exists
  const existingUser = await User.findOne({ email: investor.email });
  if (existingUser) {
    return res.status(400).json({
      message: 'A user account with this email already exists'
    });
  }

  try {
    // Create user account
    const newUser = await User.create({
      name: investor.name,
      email: investor.email,
      password,
      role: 'investor',
      phone: investor.phone
    });

    // Link user to investor
    investor.userId = newUser._id;
    await investor.save();

    // Send credentials email if requested
    if (sendCredentials) {
      try {
        const emailResult = await emailService.sendWelcomeEmail(investor, {
          email: investor.email,
          password,
          isTemporary: temporaryPassword
        });
        console.log('Email result:', emailResult);
      } catch (emailError) {
        console.error('Failed to send credentials email:', emailError);
      }
    }

    res.json({
      success: true,
      message: 'User account created successfully',
      data: {
        userId: newUser._id,
        emailSent: sendCredentials
      }
    });
  } catch (error) {
    console.error('Failed to create user account:', error);
    res.status(500).json({
      message: 'Failed to create user account',
      error: error.message
    });
  }
}));

// NEW: @route   POST /api/investors/:id/reset-password
// @desc    Reset password for investor's user account
// @access  Private (Admin, Finance Manager)
router.post('/:id/reset-password', authenticate, authorize('admin', 'finance_manager'), [
  body('newPassword').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('sendCredentials').optional().isBoolean()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: 'Validation failed', 
      errors: errors.array() 
    });
  }

  const investor = await Investor.findById(req.params.id).populate('userId');
  if (!investor) {
    return res.status(404).json({ message: 'Investor not found' });
  }

  if (!investor.userId) {
    return res.status(400).json({ 
      message: 'No user account exists for this investor' 
    });
  }

  const { newPassword, sendCredentials = false } = req.body;

  try {
    // Update user password
    const user = investor.userId;
    user.password = newPassword;
    await user.save();

    // Send new credentials email if requested
    if (sendCredentials) {
      try {
        const emailResult = await emailService.sendPasswordResetEmail(investor, newPassword);
        console.log('Password reset email result:', emailResult);
      } catch (emailError) {
        console.error('Failed to send password reset email:', emailError);
      }
    }

    res.json({
      success: true,
      message: 'Password reset successfully',
      data: {
        emailSent: sendCredentials
      }
    });
  } catch (error) {
    console.error('Failed to reset password:', error);
    res.status(500).json({
      message: 'Failed to reset password',
      error: error.message
    });
  }
}));

// @route   POST /api/investors/:id/documents
// @desc    Upload investor documents
// @access  Private (Admin, Finance Manager)
router.post('/:id/documents', 
  authenticate, 
  authorize('admin', 'finance_manager'),
  uploadMultiple('documents'),
  handleUploadError,
  asyncHandler(async (req, res) => {
    const investor = await Investor.findById(req.params.id);
    if (!investor) {
      return res.status(404).json({ message: 'Investor not found' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }

    // Add uploaded files to investor's agreements
    const newDocuments = req.files.map(file => ({
      fileName: file.originalname,
      filePath: file.path,
      uploadDate: new Date()
    }));

    investor.agreements.push(...newDocuments);
    await investor.save();

    res.json({
      success: true,
      message: 'Documents uploaded successfully',
      data: {
        uploaded: newDocuments.length,
        documents: investor.agreements
      }
    });
  })
);

// NEW: @route   POST /api/investors/test-email
// @desc    Test email configuration
// @access  Private (Admin only)
router.post('/test-email', authenticate, authorize('admin'), [
  body('email').isEmail().withMessage('Valid email is required')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: 'Validation failed', 
      errors: errors.array() 
    });
  }

  const { email } = req.body;

  try {
    const result = await emailService.sendTestEmail(email);
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Test email sent successfully',
        data: {
          messageId: result.messageId,
          sentTo: email
        }
      });
    } else {
      res.status(500).json({
        success: false,
        message: result.message,
        error: result.error
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to send test email',
      error: error.message
    });
  }
}));

// @route   GET /api/investors/stats/overview
// @desc    Get investors overview stats
// @access  Private (Admin, Finance Manager)
router.get('/stats/overview', authenticate, authorize('admin', 'finance_manager'), asyncHandler(async (req, res) => {
  const [
    totalInvestors,
    activeInvestors,
    newThisMonth,
    totalInvestment,
    averageInvestment,
    withUserAccounts,
    activeUserAccounts
  ] = await Promise.all([
    Investor.countDocuments(),
    Investor.countDocuments({ status: 'active' }),
    Investor.countDocuments({
      createdAt: {
        $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      }
    }),
    Investor.aggregate([
      { $group: { _id: null, total: { $sum: '$totalInvestment' } } }
    ]),
    Investor.aggregate([
      { $group: { _id: null, average: { $avg: '$totalInvestment' } } }
    ]),
    Investor.countDocuments({ userId: { $ne: null } }),
    Investor.aggregate([
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user'
        }
      },
      {
        $match: {
          'user.isActive': true
        }
      },
      {
        $count: 'activeUsers'
      }
    ])
  ]);

  res.json({
    success: true,
    data: {
      totalInvestors,
      activeInvestors,
      inactiveInvestors: totalInvestors - activeInvestors,
      newThisMonth,
      totalInvestment: totalInvestment[0]?.total || 0,
      averageInvestment: averageInvestment[0]?.average || 0,
      withUserAccounts,
      activeUserAccounts: activeUserAccounts[0]?.activeUsers || 0,
      userAccountPercentage: totalInvestors > 0 ? Math.round((withUserAccounts / totalInvestors) * 100) : 0
    }
  });
}));

export default router;