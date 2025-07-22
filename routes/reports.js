import express from 'express';
import { query, validationResult } from 'express-validator';
import Investment from '../models/Investment.js';
import Investor from '../models/Investor.js';
import Payment from '../models/Payment.js';
import Plan from '../models/Plan.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

// @route   GET /api/reports/dashboard
// @desc    Get dashboard summary report
// @access  Private (Admin, Finance Manager)
router.get('/dashboard', authenticate, authorize('admin', 'finance_manager'), asyncHandler(async (req, res) => {
  const [
    totalInvestments,
    totalInvestors,
    totalPlans,
    totalPayments,
    monthlyInvestments,
    monthlyPayments,
    planWiseData,
    statusWiseData
  ] = await Promise.all([
    Investment.countDocuments(),
    Investor.countDocuments(),
    Plan.countDocuments(),
    Payment.countDocuments(),
    Investment.aggregate([
      {
        $group: {
          _id: {
            year: { $year: '$investmentDate' },
            month: { $month: '$investmentDate' }
          },
          count: { $sum: 1 },
          totalAmount: { $sum: '$principalAmount' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
      { $limit: 12 }
    ]),
    Payment.aggregate([
      {
        $group: {
          _id: {
            year: { $year: '$paymentDate' },
            month: { $month: '$paymentDate' }
          },
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
      { $limit: 12 }
    ]),
    Investment.aggregate([
      {
        $lookup: {
          from: 'plans',
          localField: 'plan',
          foreignField: '_id',
          as: 'planInfo'
        }
      },
      {
        $group: {
          _id: '$plan',
          planName: { $first: { $arrayElemAt: ['$planInfo.name', 0] } },
          count: { $sum: 1 },
          totalAmount: { $sum: '$principalAmount' }
        }
      }
    ]),
    Investment.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$principalAmount' }
        }
      }
    ])
  ]);

  res.json({
    success: true,
    data: {
      summary: {
        totalInvestments,
        totalInvestors,
        totalPlans,
        totalPayments
      },
      monthlyInvestments,
      monthlyPayments,
      planWiseData,
      statusWiseData
    }
  });
}));

// @route   GET /api/reports/investor-summary
// @desc    Get investor-wise summary report
// @access  Private (Admin, Finance Manager)
router.get('/investor-summary', authenticate, authorize('admin', 'finance_manager'), [
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  query('status').optional().isIn(['active', 'inactive', 'blocked'])
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: 'Validation failed', 
      errors: errors.array() 
    });
  }

  const { startDate, endDate, status } = req.query;
  
  let matchConditions = {};
  if (status) matchConditions.status = status;

  const investorSummary = await Investor.aggregate([
    { $match: matchConditions },
    {
      $lookup: {
        from: 'investments',
        localField: '_id',
        foreignField: 'investor',
        as: 'investments'
      }
    },
    {
      $lookup: {
        from: 'payments',
        localField: '_id',
        foreignField: 'investor',
        as: 'payments'
      }
    },
    {
      $project: {
        investorId: 1,
        name: 1,
        email: 1,
        phone: 1,
        status: 1,
        totalInvestments: { $size: '$investments' },
        totalInvestedAmount: { $sum: '$investments.principalAmount' },
        totalExpectedReturns: { $sum: '$investments.totalExpectedReturns' },
        totalPaymentsReceived: { $sum: '$payments.amount' },
        remainingAmount: { $sum: '$investments.remainingAmount' },
        activeInvestments: {
          $size: {
            $filter: {
              input: '$investments',
              cond: { $eq: ['$$this.status', 'active'] }
            }
          }
        },
        completedInvestments: {
          $size: {
            $filter: {
              input: '$investments',
              cond: { $eq: ['$$this.status', 'completed'] }
            }
          }
        }
      }
    },
    { $sort: { totalInvestedAmount: -1 } }
  ]);

  res.json({
    success: true,
    data: investorSummary
  });
}));

// @route   GET /api/reports/plan-performance
// @desc    Get plan-wise performance report
// @access  Private (Admin, Finance Manager)
router.get('/plan-performance', authenticate, authorize('admin', 'finance_manager'), asyncHandler(async (req, res) => {
  const planPerformance = await Plan.aggregate([
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
        planId: 1,
        name: 1,
        interestType: 1,
        interestRate: 1,
        tenure: 1,
        isActive: 1,
        totalInvestors: { $size: '$investments' },
        totalInvestment: { $sum: '$investments.principalAmount' },
        totalExpectedReturns: { $sum: '$investments.totalExpectedReturns' },
        activeInvestments: {
          $size: {
            $filter: {
              input: '$investments',
              cond: { $eq: ['$$this.status', 'active'] }
            }
          }
        },
        completedInvestments: {
          $size: {
            $filter: {
              input: '$investments',
              cond: { $eq: ['$$this.status', 'completed'] }
            }
          }
        },
        averageInvestmentSize: {
          $cond: {
            if: { $gt: [{ $size: '$investments' }, 0] },
            then: { $divide: [{ $sum: '$investments.principalAmount' }, { $size: '$investments' }] },
            else: 0
          }
        }
      }
    },
    { $sort: { totalInvestment: -1 } }
  ]);

  res.json({
    success: true,
    data: planPerformance
  });
}));

// @route   GET /api/reports/payment-analysis
// @desc    Get payment analysis report
// @access  Private (Admin, Finance Manager)
router.get('/payment-analysis', authenticate, authorize('admin', 'finance_manager'), [
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: 'Validation failed', 
      errors: errors.array() 
    });
  }

  const { startDate, endDate } = req.query;
  
  let dateFilter = {};
  if (startDate || endDate) {
    dateFilter.paymentDate = {};
    if (startDate) dateFilter.paymentDate.$gte = new Date(startDate);
    if (endDate) dateFilter.paymentDate.$lte = new Date(endDate);
  }

  const [
    paymentsByMethod,
    paymentsByStatus,
    monthlyPayments,
    overdueAnalysis
  ] = await Promise.all([
    Payment.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: '$paymentMethod',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ]),
    Payment.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ]),
    Payment.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: {
            year: { $year: '$paymentDate' },
            month: { $month: '$paymentDate' }
          },
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          interestAmount: { $sum: '$interestAmount' },
          principalAmount: { $sum: '$principalAmount' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]),
    Investment.aggregate([
      { $unwind: '$schedule' },
      {
        $match: {
          'schedule.status': { $in: ['overdue', 'pending'] },
          'schedule.dueDate': { $lt: new Date() }
        }
      },
      {
        $lookup: {
          from: 'investors',
          localField: 'investor',
          foreignField: '_id',
          as: 'investorInfo'
        }
      },
      {
        $project: {
          investmentId: 1,
          investor: { $arrayElemAt: ['$investorInfo', 0] },
          month: '$schedule.month',
          dueDate: '$schedule.dueDate',
          totalAmount: '$schedule.totalAmount',
          paidAmount: '$schedule.paidAmount',
          overdueAmount: { $subtract: ['$schedule.totalAmount', '$schedule.paidAmount'] },
          daysPastDue: {
            $divide: [
              { $subtract: [new Date(), '$schedule.dueDate'] },
              1000 * 60 * 60 * 24
            ]
          }
        }
      },
      { $sort: { daysPastDue: -1 } }
    ])
  ]);

  res.json({
    success: true,
    data: {
      paymentsByMethod,
      paymentsByStatus,
      monthlyPayments,
      overdueAnalysis
    }
  });
}));

// @route   GET /api/reports/overdue-payments
// @desc    Get overdue payments report
// @access  Private (Admin, Finance Manager)
router.get('/overdue-payments', authenticate, authorize('admin', 'finance_manager'), asyncHandler(async (req, res) => {
  const overduePayments = await Investment.aggregate([
    { $unwind: '$schedule' },
    {
      $match: {
        'schedule.status': { $in: ['overdue', 'pending'] },
        'schedule.dueDate': { $lt: new Date() }
      }
    },
    {
      $lookup: {
        from: 'investors',
        localField: 'investor',
        foreignField: '_id',
        as: 'investorInfo'
      }
    },
    {
      $lookup: {
        from: 'plans',
        localField: 'plan',
        foreignField: '_id',
        as: 'planInfo'
      }
    },
    {
      $project: {
        investmentId: 1,
        investor: {
          _id: { $arrayElemAt: ['$investorInfo._id', 0] },
          investorId: { $arrayElemAt: ['$investorInfo.investorId', 0] },
          name: { $arrayElemAt: ['$investorInfo.name', 0] },
          email: { $arrayElemAt: ['$investorInfo.email', 0] },
          phone: { $arrayElemAt: ['$investorInfo.phone', 0] }
        },
        plan: {
          name: { $arrayElemAt: ['$planInfo.name', 0] }
        },
        month: '$schedule.month',
        dueDate: '$schedule.dueDate',
        totalAmount: '$schedule.totalAmount',
        paidAmount: '$schedule.paidAmount',
        overdueAmount: { $subtract: ['$schedule.totalAmount', '$schedule.paidAmount'] },
        daysPastDue: {
          $ceil: {
            $divide: [
              { $subtract: [new Date(), '$schedule.dueDate'] },
              1000 * 60 * 60 * 24
            ]
          }
        }
      }
    },
    { $sort: { daysPastDue: -1 } }
  ]);

  res.json({
    success: true,
    data: overduePayments
  });
}));

// @route   GET /api/reports/export/investors
// @desc    Export investor data (CSV format)
// @access  Private (Admin, Finance Manager)
router.get('/export/investors', authenticate, authorize('admin', 'finance_manager'), asyncHandler(async (req, res) => {
  const investors = await Investor.find()
    .populate('createdBy', 'name')
    .sort({ createdAt: -1 });

  // Generate CSV content
  const csvHeader = 'Investor ID,Name,Email,Phone,Total Investment,Active Investments,Total Returns,Status,Created Date\n';
  const csvContent = investors.map(investor => 
    `${investor.investorId},"${investor.name}","${investor.email}","${investor.phone}",${investor.totalInvestment},${investor.activeInvestments},${investor.totalReturns},${investor.status},${investor.createdAt.toISOString().split('T')[0]}`
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=investors_report.csv');
  res.send(csvHeader + csvContent);
}));

// @route   GET /api/reports/export/investments
// @desc    Export investment data (CSV format)
// @access  Private (Admin, Finance Manager)
router.get('/export/investments', authenticate, authorize('admin', 'finance_manager'), asyncHandler(async (req, res) => {
  const investments = await Investment.find()
    .populate('investor', 'investorId name email')
    .populate('plan', 'planId name interestRate')
    .sort({ createdAt: -1 });

  // Generate CSV content
  const csvHeader = 'Investment ID,Investor Name,Plan Name,Principal Amount,Interest Rate,Investment Date,Maturity Date,Status,Total Expected Returns,Total Paid,Remaining Amount\n';
  const csvContent = investments.map(investment => 
    `${investment.investmentId},"${investment.investor.name}","${investment.plan.name}",${investment.principalAmount},${investment.interestRate}%,${investment.investmentDate.toISOString().split('T')[0]},${investment.maturityDate.toISOString().split('T')[0]},${investment.status},${investment.totalExpectedReturns},${investment.totalPaidAmount},${investment.remainingAmount}`
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=investments_report.csv');
  res.send(csvHeader + csvContent);
}));

// @route   GET /api/reports/export/payments
// @desc    Export payment data (CSV format)
// @access  Private (Admin, Finance Manager)
router.get('/export/payments', authenticate, authorize('admin', 'finance_manager'), asyncHandler(async (req, res) => {
  const payments = await Payment.find()
    .populate('investment', 'investmentId')
    .populate('investor', 'investorId name')
    .sort({ createdAt: -1 });

  // Generate CSV content
  const csvHeader = 'Payment ID,Investment ID,Investor Name,Amount,Payment Date,Payment Method,Status,Interest Amount,Principal Amount,Reference Number\n';
  const csvContent = payments.map(payment => 
    `${payment.paymentId},${payment.investment.investmentId},"${payment.investor.name}",${payment.amount},${payment.paymentDate.toISOString().split('T')[0]},${payment.paymentMethod},${payment.status},${payment.interestAmount},${payment.principalAmount},"${payment.referenceNumber || ''}"`
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=payments_report.csv');
  res.send(csvHeader + csvContent);
}));

export default router;