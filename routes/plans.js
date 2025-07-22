// backend/routes/plans.js - Simplified Plans Routes
import express from 'express';
import { body, validationResult, query } from 'express-validator';
import Plan from '../models/Plan.js';
import Investment from '../models/Investment.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

// @route   GET /api/plans
// @desc    Get all plans with pagination and search
// @access  Private
router.get('/', authenticate, [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('search').optional().trim(),
  query('isActive').optional().isBoolean(),
  query('paymentType').optional().isIn(['interest', 'interestWithPrincipal']),
  query('interestType').optional().isIn(['flat', 'reducing'])
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
  const isActive = req.query.isActive;
  const paymentType = req.query.paymentType;
  const interestType = req.query.interestType;

  // Build query
  let query = {};
  
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { planId: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } }
    ];
  }

  if (isActive !== undefined) {
    query.isActive = isActive === 'true';
  }

  if (paymentType) {
    query.paymentType = paymentType;
  }

  if (interestType) {
    query.interestType = interestType;
  }

  const [plans, total] = await Promise.all([
    Plan.find(query)
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Plan.countDocuments(query)
  ]);

  res.json({
    success: true,
    data: plans,
    pagination: {
      current: page,
      pages: Math.ceil(total / limit),
      total,
      limit
    }
  });
}));

// @route   GET /api/plans/active
// @desc    Get all active plans (for investment creation)
// @access  Private
router.get('/active', authenticate, asyncHandler(async (req, res) => {
  const plans = await Plan.find({ isActive: true })
    .select('-__v')
    .sort({ name: 1 });

  res.json({
    success: true,
    data: plans
  });
}));

// @route   GET /api/plans/:id
// @desc    Get single plan
// @access  Private
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const plan = await Plan.findById(req.params.id)
    .populate('createdBy', 'name email');

  if (!plan) {
    return res.status(404).json({ message: 'Plan not found' });
  }

  // Get investments summary for this plan
  const investmentStats = await Investment.aggregate([
    { $match: { plan: plan._id } },
    {
      $group: {
        _id: null,
        totalInvestments: { $sum: 1 },
        totalAmount: { $sum: '$principalAmount' },
        activeInvestments: {
          $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
        }
      }
    }
  ]);

  res.json({
    success: true,
    data: {
      ...plan.toObject(),
      investmentStats: investmentStats[0] || {
        totalInvestments: 0,
        totalAmount: 0,
        activeInvestments: 0
      }
    }
  });
}));

// @route   POST /api/plans
// @desc    Create new plan
// @access  Private (Admin, Finance Manager)
router.post('/', authenticate, authorize('admin', 'finance_manager'), [
  body('name').trim().notEmpty().withMessage('Plan name is required'),
  body('description').optional().trim(),
  body('interestType').isIn(['flat', 'reducing']).withMessage('Interest type must be flat or reducing'),
  body('interestRate').isFloat({ min: 0, max: 100 }).withMessage('Interest rate must be between 0 and 100'),
  body('minInvestment').isFloat({ min: 1000 }).withMessage('Minimum investment must be at least 1000'),
  body('maxInvestment').isFloat({ min: 1000 }).withMessage('Maximum investment must be at least 1000'),
  body('tenure').isInt({ min: 1, max: 240 }).withMessage('Tenure must be between 1 and 240 months'),
  body('paymentType').isIn(['interest', 'interestWithPrincipal']).withMessage('Invalid payment type'),
  body('features').optional().isArray(),
  body('riskLevel').optional().isIn(['low', 'medium', 'high']),
  
  // Interest payment validation
  body('interestPayment.dateOfInvestment').optional().isISO8601().withMessage('Invalid date'),
  body('interestPayment.amountInvested').optional().isFloat({ min: 0 }),
  body('interestPayment.interestFrequency').optional().isIn(['monthly', 'quarterly', 'half-yearly', 'yearly', 'others']),
  body('interestPayment.principalRepaymentOption').optional().isIn(['fixed', 'flexible']),
  body('interestPayment.withdrawalAfterPercentage').optional().isFloat({ min: 0, max: 100 }),
  body('interestPayment.principalSettlementTerm').optional().isInt({ min: 1 }),
  
  // Interest with principal validation
  body('interestWithPrincipalPayment.dateOfInvestment').optional().isISO8601().withMessage('Invalid date'),
  body('interestWithPrincipalPayment.investedAmount').optional().isFloat({ min: 0 }),
  body('interestWithPrincipalPayment.principalRepaymentPercentage').optional().isFloat({ min: 0, max: 100 }),
  body('interestWithPrincipalPayment.paymentFrequency').optional().isIn(['monthly', 'quarterly', 'half-yearly', 'yearly', 'others'])
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: 'Validation failed', 
      errors: errors.array() 
    });
  }

  const planData = req.body;

  // Validate that maxInvestment >= minInvestment
  if (planData.maxInvestment < planData.minInvestment) {
    return res.status(400).json({ 
      message: 'Maximum investment must be greater than or equal to minimum investment' 
    });
  }

  // Validate payment type specific fields
  if (planData.paymentType === 'interest') {
    if (!planData.interestPayment) {
      return res.status(400).json({
        message: 'Interest payment configuration is required for interest payment type'
      });
    }
  } else if (planData.paymentType === 'interestWithPrincipal') {
    if (!planData.interestWithPrincipalPayment) {
      return res.status(400).json({
        message: 'Interest with principal payment configuration is required'
      });
    }
  }

  const plan = await Plan.create({
    ...planData,
    createdBy: req.user._id
  });

  await plan.populate('createdBy', 'name email');

  res.status(201).json({
    success: true,
    message: 'Plan created successfully',
    data: plan
  });
}));

// @route   PUT /api/plans/:id
// @desc    Update plan
// @access  Private (Admin, Finance Manager)
router.put('/:id', authenticate, authorize('admin', 'finance_manager'), [
  body('name').optional().trim().notEmpty().withMessage('Plan name cannot be empty'),
  body('description').optional().trim(),
  body('interestType').optional().isIn(['flat', 'reducing']).withMessage('Interest type must be flat or reducing'),
  body('interestRate').optional().isFloat({ min: 0, max: 100 }).withMessage('Interest rate must be between 0 and 100'),
  body('minInvestment').optional().isFloat({ min: 1000 }).withMessage('Minimum investment must be at least 1000'),
  body('maxInvestment').optional().isFloat({ min: 1000 }).withMessage('Maximum investment must be at least 1000'),
  body('tenure').optional().isInt({ min: 1, max: 240 }).withMessage('Tenure must be between 1 and 240 months'),
  body('paymentType').optional().isIn(['interest', 'interestWithPrincipal']).withMessage('Invalid payment type'),
  body('isActive').optional().isBoolean(),
  body('features').optional().isArray(),
  body('riskLevel').optional().isIn(['low', 'medium', 'high'])
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: 'Validation failed', 
      errors: errors.array() 
    });
  }

  const plan = await Plan.findById(req.params.id);
  if (!plan) {
    return res.status(404).json({ message: 'Plan not found' });
  }

  const updateData = req.body;

  // Validate constraints if being updated
  const finalMinInvestment = updateData.minInvestment || plan.minInvestment;
  const finalMaxInvestment = updateData.maxInvestment || plan.maxInvestment;

  if (finalMaxInvestment < finalMinInvestment) {
    return res.status(400).json({ 
      message: 'Maximum investment must be greater than or equal to minimum investment' 
    });
  }

  // Check if plan has active investments before making major changes
  const activeInvestments = await Investment.countDocuments({
    plan: plan._id,
    status: 'active'
  });

  const majorFields = ['interestType', 'interestRate', 'tenure', 'paymentType'];
  const hasMajorChanges = majorFields.some(field => updateData[field] !== undefined);

  if (activeInvestments > 0 && hasMajorChanges) {
    return res.status(400).json({ 
      message: 'Cannot modify core plan parameters when there are active investments. Please create a new plan instead.' 
    });
  }

  // Update plan
  Object.assign(plan, updateData);
  await plan.save();
  await plan.populate('createdBy', 'name email');

  res.json({
    success: true,
    message: 'Plan updated successfully',
    data: plan
  });
}));

// @route   DELETE /api/plans/:id
// @desc    Delete plan
// @access  Private (Admin only)
router.delete('/:id', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const plan = await Plan.findById(req.params.id);
  if (!plan) {
    return res.status(404).json({ message: 'Plan not found' });
  }

  // Check if plan has any investments
  const investmentCount = await Investment.countDocuments({ plan: plan._id });
  if (investmentCount > 0) {
    return res.status(400).json({ 
      message: 'Cannot delete plan with existing investments' 
    });
  }

  await plan.deleteOne();

  res.json({
    success: true,
    message: 'Plan deleted successfully'
  });
}));

// @route   POST /api/plans/:id/calculate
// @desc    Calculate returns for a given principal amount
// @access  Private
router.post('/:id/calculate', authenticate, [
  body('principalAmount').isFloat({ min: 1 }).withMessage('Principal amount must be greater than 0')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: 'Validation failed', 
      errors: errors.array() 
    });
  }

  const plan = await Plan.findById(req.params.id);
  if (!plan) {
    return res.status(404).json({ message: 'Plan not found' });
  }

  const { principalAmount } = req.body;

  // Validate amount is within plan limits
  if (principalAmount < plan.minInvestment || principalAmount > plan.maxInvestment) {
    return res.status(400).json({ 
      message: `Investment amount must be between ₹${plan.minInvestment} and ₹${plan.maxInvestment}` 
    });
  }

  const returns = plan.calculateExpectedReturns(principalAmount);

  res.json({
    success: true,
    data: {
      principalAmount,
      plan: {
        name: plan.name,
        paymentType: plan.paymentType,
        interestType: plan.interestType,
        interestRate: plan.interestRate,
        tenure: plan.tenure
      },
      calculations: returns
    }
  });
}));

// @route   POST /api/plans/:id/generate-schedule
// @desc    Generate payment schedule for a plan with specific investment amount
// @access  Private
router.post('/:id/generate-schedule', authenticate, [
  body('principalAmount').isFloat({ min: 1 }).withMessage('Principal amount must be greater than 0'),
  body('investmentDate').optional().isISO8601().withMessage('Invalid investment date')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: 'Validation failed', 
      errors: errors.array() 
    });
  }

  const plan = await Plan.findById(req.params.id);
  if (!plan) {
    return res.status(404).json({ message: 'Plan not found' });
  }

  const { principalAmount, investmentDate } = req.body;

  // Validate amount is within plan limits
  if (principalAmount < plan.minInvestment || principalAmount > plan.maxInvestment) {
    return res.status(400).json({ 
      message: `Investment amount must be between ₹${plan.minInvestment} and ₹${plan.maxInvestment}` 
    });
  }

  const invDate = investmentDate ? new Date(investmentDate) : new Date();
  const schedule = plan.generateSchedule(principalAmount, invDate);

  res.json({
    success: true,
    data: {
      plan: {
        name: plan.name,
        paymentType: plan.paymentType,
        interestType: plan.interestType,
        interestRate: plan.interestRate,
        tenure: plan.tenure
      },
      principalAmount,
      investmentDate: invDate,
      schedule
    }
  });
}));

// @route   GET /api/plans/stats/overview
// @desc    Get plans overview stats
// @access  Private (Admin, Finance Manager)
router.get('/stats/overview', authenticate, authorize('admin', 'finance_manager'), asyncHandler(async (req, res) => {
  const [
    totalPlans,
    activePlans,
    plansByType,
    plansByPaymentType,
    mostPopularPlan
  ] = await Promise.all([
    Plan.countDocuments(),
    Plan.countDocuments({ isActive: true }),
    Plan.aggregate([
      {
        $group: {
          _id: '$interestType',
          count: { $sum: 1 },
          averageRate: { $avg: '$interestRate' }
        }
      }
    ]),
    Plan.aggregate([
      {
        $group: {
          _id: '$paymentType',
          count: { $sum: 1 },
          averageRate: { $avg: '$interestRate' }
        }
      }
    ]),
    Plan.aggregate([
      {
        $lookup: {
          from: 'investments',
          localField: '_id',
          foreignField: 'plan',
          as: 'investments'
        }
      },
      {
        $project: {
          name: 1,
          paymentType: 1,
          investmentCount: { $size: '$investments' },
          totalInvestment: { $sum: '$investments.principalAmount' }
        }
      },
      { $sort: { investmentCount: -1 } },
      { $limit: 1 }
    ])
  ]);

  res.json({
    success: true,
    data: {
      totalPlans,
      activePlans,
      inactivePlans: totalPlans - activePlans,
      plansByType,
      plansByPaymentType,
      mostPopularPlan: mostPopularPlan[0] || null
    }
  });
}));

export default router;