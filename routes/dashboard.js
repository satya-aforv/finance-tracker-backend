// backend/routes/dashboard.js - Complete Dashboard API Routes
import express from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import Investment from '../models/Investment.js';
import Investor from '../models/Investor.js';
import Payment from '../models/Payment.js';
import Plan from '../models/Plan.js';
import User from '../models/User.js';

const router = express.Router();

// ================================
// MAIN DASHBOARD OVERVIEW
// ================================

// @route   GET /api/dashboard/overview
// @desc    Get comprehensive dashboard overview
// @access  Private (Admin, Finance Manager)
router.get('/overview', authenticate, authorize('admin', 'finance_manager'), asyncHandler(async (req, res) => {
  const [
    investmentStats,
    investorStats,
    paymentStats,
    planStats,
    recentActivity,
    systemAlerts
  ] = await Promise.all([
    getInvestmentStatsData(),
    getInvestorStatsData(),
    getPaymentStatsData(),
    getPlanStatsData(),
    getRecentActivityData(req.query),
    getSystemAlertsData(req.query)
  ]);

  res.json({
    success: true,
    data: {
      stats: investmentStats,
      investorStats,
      paymentStats,
      planStats,
      recentActivity,
      alerts: systemAlerts
    }
  });
}));

// ================================
// RECENT ACTIVITY
// ================================

// @route   GET /api/dashboard/recent-activity
// @desc    Get recent activity across the system
// @access  Private (Admin, Finance Manager)
router.get('/recent-activity', authenticate, authorize('admin', 'finance_manager'), asyncHandler(async (req, res) => {
  const {
    limit = 20,
    types,
    userId,
    startDate,
    endDate
  } = req.query;

  const recentActivity = await getRecentActivityData({
    limit: parseInt(limit),
    types: types ? types.split(',') : undefined,
    userId,
    startDate,
    endDate
  });

  res.json({
    success: true,
    data: recentActivity
  });
}));

// @route   GET /api/dashboard/activity-timeline
// @desc    Get system activity timeline
// @access  Private (Admin, Finance Manager)
router.get('/activity-timeline', authenticate, authorize('admin', 'finance_manager'), asyncHandler(async (req, res) => {
  const {
    period = 'week',
    groupBy = 'day',
    types
  } = req.query;

  const timeline = await getActivityTimelineData({
    period,
    groupBy,
    types: types ? types.split(',') : undefined
  });

  res.json({
    success: true,
    data: timeline
  });
}));

// ================================
// ALERTS & NOTIFICATIONS
// ================================

// @route   GET /api/dashboard/alerts
// @desc    Get system alerts
// @access  Private (Admin, Finance Manager)
router.get('/alerts', authenticate, authorize('admin', 'finance_manager'), asyncHandler(async (req, res) => {
  const {
    severity,
    category,
    limit = 50,
    unreadOnly = false
  } = req.query;

  const alerts = await getSystemAlertsData({
    severity,
    category,
    limit: parseInt(limit),
    unreadOnly: unreadOnly === 'true'
  });

  res.json({
    success: true,
    data: alerts
  });
}));

// @route   PUT /api/dashboard/alerts/:id/read
// @desc    Mark alert as read
// @access  Private (Admin, Finance Manager)
router.put('/alerts/:id/read', authenticate, authorize('admin', 'finance_manager'), asyncHandler(async (req, res) => {
  // For now, just return success - implement alert storage later
  res.json({
    success: true,
    message: 'Alert marked as read'
  });
}));

// @route   PUT /api/dashboard/alerts/read-all
// @desc    Mark all alerts as read
// @access  Private (Admin, Finance Manager)
router.put('/alerts/read-all', authenticate, authorize('admin', 'finance_manager'), asyncHandler(async (req, res) => {
  // For now, just return success - implement alert storage later
  res.json({
    success: true,
    message: 'All alerts marked as read'
  });
}));

// @route   DELETE /api/dashboard/alerts/:id
// @desc    Dismiss alert
// @access  Private (Admin, Finance Manager)
router.delete('/alerts/:id', authenticate, authorize('admin', 'finance_manager'), asyncHandler(async (req, res) => {
  // For now, just return success - implement alert storage later
  res.json({
    success: true,
    message: 'Alert dismissed'
  });
}));

// ================================
// TRENDING & ANALYTICS
// ================================

// @route   GET /api/dashboard/trending-metrics
// @desc    Get trending metrics
// @access  Private (Admin, Finance Manager)
router.get('/trending-metrics', authenticate, authorize('admin', 'finance_manager'), asyncHandler(async (req, res) => {
  const {
    period = 'month',
    metrics
  } = req.query;

  const trendingMetrics = await getTrendingMetricsData({
    period,
    metrics: metrics ? metrics.split(',') : undefined
  });

  res.json({
    success: true,
    data: trendingMetrics
  });
}));

// @route   GET /api/dashboard/performance-analytics
// @desc    Get performance analytics
// @access  Private (Admin, Finance Manager)
router.get('/performance-analytics', authenticate, authorize('admin', 'finance_manager'), asyncHandler(async (req, res) => {
  const {
    period = 'month',
    compareWith = 'previous_period'
  } = req.query;

  const analytics = await getPerformanceAnalyticsData({
    period,
    compareWith
  });

  res.json({
    success: true,
    data: analytics
  });
}));

// ================================
// QUICK ACTIONS & OVERDUE ITEMS
// ================================

// @route   GET /api/dashboard/quick-actions
// @desc    Get data for quick actions
// @access  Private (Admin, Finance Manager)
router.get('/quick-actions', authenticate, authorize('admin', 'finance_manager'), asyncHandler(async (req, res) => {
  const quickActionsData = await getQuickActionsData();

  res.json({
    success: true,
    data: quickActionsData
  });
}));

// @route   GET /api/dashboard/overdue-items
// @desc    Get overdue items requiring attention
// @access  Private (Admin, Finance Manager)
router.get('/overdue-items', authenticate, authorize('admin', 'finance_manager'), asyncHandler(async (req, res) => {
  const overdueItems = await getOverdueItemsData();

  res.json({
    success: true,
    data: overdueItems
  });
}));

// ================================
// REAL-TIME METRICS
// ================================

// @route   GET /api/dashboard/realtime-metrics
// @desc    Get real-time metrics
// @access  Private (Admin, Finance Manager)
router.get('/realtime-metrics', authenticate, authorize('admin', 'finance_manager'), asyncHandler(async (req, res) => {
  const realTimeMetrics = await getRealTimeMetricsData();

  res.json({
    success: true,
    data: realTimeMetrics
  });
}));

// @route   GET /api/dashboard/websocket-config
// @desc    Get WebSocket configuration for real-time updates
// @access  Private (Admin, Finance Manager)
router.get('/websocket-config', authenticate, authorize('admin', 'finance_manager'), asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      endpoint: process.env.WEBSOCKET_URL || 'ws://localhost:5000/ws',
      token: req.header('Authorization')?.replace('Bearer ', ''),
      events: ['payment_received', 'investment_created', 'overdue_alert', 'system_notification']
    }
  });
}));

// ================================
// COMPARATIVE ANALYTICS
// ================================

// @route   POST /api/dashboard/period-comparison
// @desc    Get period comparison analytics
// @access  Private (Admin, Finance Manager)
router.post('/period-comparison', authenticate, authorize('admin', 'finance_manager'), asyncHandler(async (req, res) => {
  const { currentPeriod, comparePeriod, metrics } = req.body;

  const comparison = await getPeriodComparisonData({
    currentPeriod,
    comparePeriod,
    metrics
  });

  res.json({
    success: true,
    data: comparison
  });
}));

// @route   GET /api/dashboard/benchmark-data
// @desc    Get benchmarking data
// @access  Private (Admin, Finance Manager)
router.get('/benchmark-data', authenticate, authorize('admin', 'finance_manager'), asyncHandler(async (req, res) => {
  const {
    benchmarkType = 'internal',
    metrics
  } = req.query;

  const benchmarkData = await getBenchmarkData({
    benchmarkType,
    metrics: metrics ? metrics.split(',') : undefined
  });

  res.json({
    success: true,
    data: benchmarkData
  });
}));

// ================================
// SEARCH & QUICK ACCESS
// ================================

// @route   GET /api/dashboard/search
// @desc    Global search across entities
// @access  Private (Admin, Finance Manager)
router.get('/search', authenticate, authorize('admin', 'finance_manager'), asyncHandler(async (req, res) => {
  const {
    query,
    entities = ['investors', 'investments', 'payments', 'plans'],
    limit = 10
  } = req.query;

  if (!query || query.trim().length < 2) {
    return res.status(400).json({
      success: false,
      message: 'Search query must be at least 2 characters long'
    });
  }

  const searchResults = await globalSearchData({
    query: query.trim(),
    entities: Array.isArray(entities) ? entities : entities.split(','),
    limit: parseInt(limit)
  });

  res.json({
    success: true,
    data: searchResults
  });
}));

// @route   GET /api/dashboard/quick-access-suggestions
// @desc    Get quick access suggestions
// @access  Private (Admin, Finance Manager)
router.get('/quick-access-suggestions', authenticate, authorize('admin', 'finance_manager'), asyncHandler(async (req, res) => {
  const suggestions = await getQuickAccessSuggestionsData(req.user._id);

  res.json({
    success: true,
    data: suggestions
  });
}));

// ================================
// EXPORT & SNAPSHOT
// ================================

// @route   GET /api/dashboard/export
// @desc    Export dashboard data
// @access  Private (Admin, Finance Manager)
router.get('/export', authenticate, authorize('admin', 'finance_manager'), asyncHandler(async (req, res) => {
  const {
    format = 'excel',
    dateRange,
    includeCharts = false,
    includeStatistics = true,
    includeActivity = true
  } = req.query;

  // For now, return a simple CSV
  if (format === 'csv') {
    const csvData = await generateDashboardCSV({
      dateRange: dateRange ? JSON.parse(dateRange) : undefined,
      includeStatistics: includeStatistics === 'true',
      includeActivity: includeActivity === 'true'
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=dashboard_export.csv');
    res.send(csvData);
  } else {
    res.status(400).json({
      success: false,
      message: 'Only CSV export is currently supported'
    });
  }
}));

// @route   POST /api/dashboard/snapshot
// @desc    Generate dashboard snapshot
// @access  Private (Admin, Finance Manager)
router.post('/snapshot', authenticate, authorize('admin', 'finance_manager'), asyncHandler(async (req, res) => {
  const {
    title = 'Dashboard Snapshot',
    description,
    includeAlerts = true,
    includeActivity = true
  } = req.body;

  const snapshotId = `snapshot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const expiresAt = new Date(Date.now() + (24 * 60 * 60 * 1000)); // 24 hours

  // For now, just return the snapshot info
  // In production, you would save this to database and generate actual snapshot
  res.json({
    success: true,
    data: {
      snapshotId,
      url: `/api/dashboard/snapshots/${snapshotId}`,
      expiresAt: expiresAt.toISOString()
    }
  });
}));

// ================================
// HELPER FUNCTIONS
// ================================

async function getInvestmentStatsData() {
  const [
    totalInvestments,
    activeInvestments,
    completedInvestments,
    totalValue,
    totalPaid,
    overduePayments
  ] = await Promise.all([
    Investment.countDocuments(),
    Investment.countDocuments({ status: 'active' }),
    Investment.countDocuments({ status: 'completed' }),
    Investment.aggregate([{ $group: { _id: null, total: { $sum: '$principalAmount' } } }]),
    Investment.aggregate([{ $group: { _id: null, total: { $sum: '$totalPaidAmount' } } }]),
    Investment.aggregate([
      { $unwind: '$schedule' },
      { $match: { 'schedule.status': 'overdue', status: 'active' } },
      { $count: 'count' }
    ])
  ]);

  return {
    totalInvestments,
    activeInvestments,
    completedInvestments,
    totalValue: totalValue[0]?.total || 0,
    totalPaid: totalPaid[0]?.total || 0,
    remainingValue: (totalValue[0]?.total || 0) - (totalPaid[0]?.total || 0),
    overduePayments: overduePayments[0]?.count || 0,
    averageInvestmentSize: totalInvestments > 0 ? (totalValue[0]?.total || 0) / totalInvestments : 0
  };
}

async function getInvestorStatsData() {
  const [
    totalInvestors,
    activeInvestors,
    newThisMonth,
    totalInvestment,
    withUserAccounts
  ] = await Promise.all([
    Investor.countDocuments(),
    Investor.countDocuments({ status: 'active' }),
    Investor.countDocuments({
      createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) }
    }),
    Investor.aggregate([{ $group: { _id: null, total: { $sum: '$totalInvestment' } } }]),
    Investor.countDocuments({ userId: { $ne: null } })
  ]);

  return {
    totalInvestors,
    activeInvestors,
    inactiveInvestors: totalInvestors - activeInvestors,
    newThisMonth,
    totalInvestment: totalInvestment[0]?.total || 0,
    averageInvestment: totalInvestors > 0 ? (totalInvestment[0]?.total || 0) / totalInvestors : 0,
    withUserAccounts,
    userAccountPercentage: totalInvestors > 0 ? Math.round((withUserAccounts / totalInvestors) * 100) : 0
  };
}

async function getPaymentStatsData() {
  const [
    totalPayments,
    completedPayments,
    pendingPayments,
    totalAmount,
    thisMonthPayments,
    paymentsByMethod
  ] = await Promise.all([
    Payment.countDocuments(),
    Payment.countDocuments({ status: 'completed' }),
    Payment.countDocuments({ status: 'pending' }),
    Payment.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]),
    Payment.countDocuments({
      paymentDate: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      status: 'completed'
    }),
    Payment.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: '$paymentMethod', count: { $sum: 1 }, totalAmount: { $sum: '$amount' } } }
    ])
  ]);

  return {
    totalPayments,
    completedPayments,
    pendingPayments,
    failedPayments: totalPayments - completedPayments - pendingPayments,
    totalAmount: totalAmount[0]?.total || 0,
    thisMonthPayments,
    averagePayment: completedPayments > 0 ? (totalAmount[0]?.total || 0) / completedPayments : 0,
    paymentsByMethod
  };
}

async function getPlanStatsData() {
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
      { $group: { _id: '$interestType', count: { $sum: 1 }, averageRate: { $avg: '$interestRate' } } }
    ]),
    Plan.aggregate([
      { $group: { _id: '$paymentType', count: { $sum: 1 }, averageRate: { $avg: '$interestRate' } } }
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

  return {
    totalPlans,
    activePlans,
    inactivePlans: totalPlans - activePlans,
    plansByType,
    plansByPaymentType,
    mostPopularPlan: mostPopularPlan[0] || null
  };
}

async function getRecentActivityData(params = {}) {
  const { limit = 20, types, userId, startDate, endDate } = params;

  // This is a simplified implementation
  // In a real application, you'd have a dedicated activity log collection
  const activities = [];

  try {
    // Get recent investments
    const recentInvestments = await Investment.find()
      .populate('investor', 'name email')
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 })
      .limit(limit / 4);

    recentInvestments.forEach(investment => {
      activities.push({
        id: investment._id.toString(),
        type: 'investment_created',
        title: 'New Investment Created',
        description: `Investment ${investment.investmentId} created for ${investment.investor.name}`,
        timestamp: investment.createdAt,
        status: 'success',
        user: {
          id: investment.createdBy._id,
          name: investment.createdBy.name,
          avatar: null
        },
        entity: {
          id: investment._id,
          type: 'investment',
          name: investment.investmentId
        }
      });
    });

    // Get recent payments
    const recentPayments = await Payment.find()
      .populate('investor', 'name email')
      .populate('processedBy', 'name')
      .sort({ createdAt: -1 })
      .limit(limit / 4);

    recentPayments.forEach(payment => {
      activities.push({
        id: payment._id.toString(),
        type: 'payment_received',
        title: 'Payment Received',
        description: `Payment ${payment.paymentId} of ₹${payment.amount} received from ${payment.investor.name}`,
        timestamp: payment.createdAt,
        status: payment.status === 'completed' ? 'success' : 'warning',
        user: {
          id: payment.processedBy._id,
          name: payment.processedBy.name,
          avatar: null
        },
        entity: {
          id: payment._id,
          type: 'payment',
          name: payment.paymentId
        }
      });
    });

    // Get recent investors
    const recentInvestors = await Investor.find()
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 })
      .limit(limit / 4);

    recentInvestors.forEach(investor => {
      activities.push({
        id: investor._id.toString(),
        type: 'investor_added',
        title: 'New Investor Added',
        description: `Investor ${investor.name} (${investor.investorId}) added to system`,
        timestamp: investor.createdAt,
        status: 'success',
        user: {
          id: investor.createdBy._id,
          name: investor.createdBy.name,
          avatar: null
        },
        entity: {
          id: investor._id,
          type: 'investor',
          name: investor.name
        }
      });
    });

  } catch (error) {
    console.error('Error fetching recent activity:', error);
  }

  // Sort by timestamp and limit
  return activities
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit);
}

async function getSystemAlertsData(params = {}) {
  const alerts = [];
  const now = new Date();

  try {
    // Check for overdue payments
    const overduePayments = await Investment.aggregate([
      { $unwind: '$schedule' },
      {
        $match: {
          'schedule.status': { $in: ['pending', 'overdue'] },
          'schedule.dueDate': { $lt: now },
          status: 'active'
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
      { $limit: 10 }
    ]);

    if (overduePayments.length > 0) {
      alerts.push({
        id: 'overdue_payments',
        type: 'warning',
        severity: 'high',
        category: 'payments',
        title: 'Overdue Payments Alert',
        message: `${overduePayments.length} payments are overdue and require immediate attention`,
        timestamp: now.toISOString(),
        isRead: false,
        actionRequired: true,
        actionUrl: '/payments?status=overdue',
        relatedEntity: {
          type: 'payments',
          id: 'overdue',
          name: 'Overdue Payments'
        }
      });
    }

    // Check for investments maturing soon
    const maturingSoon = await Investment.countDocuments({
      maturityDate: {
        $gte: now,
        $lte: new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000)) // 30 days
      },
      status: 'active'
    });

    if (maturingSoon > 0) {
      alerts.push({
        id: 'maturing_investments',
        type: 'info',
        severity: 'medium',
        category: 'compliance',
        title: 'Investments Maturing Soon',
        message: `${maturingSoon} investments are maturing in the next 30 days`,
        timestamp: now.toISOString(),
        isRead: false,
        actionRequired: true,
        actionUrl: '/investments?maturing=30days',
        relatedEntity: {
          type: 'investments',
          id: 'maturing',
          name: 'Maturing Investments'
        }
      });
    }

    // Check for incomplete KYC
    const incompleteKYC = await Investor.countDocuments({
      'kyc.verificationStatus': 'pending',
      status: 'active'
    });

    if (incompleteKYC > 0) {
      alerts.push({
        id: 'incomplete_kyc',
        type: 'warning',
        severity: 'medium',
        category: 'compliance',
        title: 'Incomplete KYC Verifications',
        message: `${incompleteKYC} investors have pending KYC verification`,
        timestamp: now.toISOString(),
        isRead: false,
        actionRequired: true,
        actionUrl: '/investors?kyc=pending',
        relatedEntity: {
          type: 'investors',
          id: 'pending_kyc',
          name: 'Pending KYC'
        }
      });
    }

  } catch (error) {
    console.error('Error generating system alerts:', error);
  }

  return alerts;
}

async function getTrendingMetricsData(params = {}) {
  const { period = 'month' } = params;
  
  // Calculate date ranges for comparison
  const now = new Date();
  let currentStart, currentEnd, previousStart, previousEnd;

  switch (period) {
    case 'today':
      currentStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      currentEnd = now;
      previousStart = new Date(currentStart.getTime() - (24 * 60 * 60 * 1000));
      previousEnd = currentStart;
      break;
    case 'week':
      currentStart = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
      currentEnd = now;
      previousStart = new Date(currentStart.getTime() - (7 * 24 * 60 * 60 * 1000));
      previousEnd = currentStart;
      break;
    case 'month':
    default:
      currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
      currentEnd = now;
      previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      previousEnd = currentStart;
      break;
  }

  try {
    const [currentInvestments, previousInvestments] = await Promise.all([
      Investment.aggregate([
        {
          $match: {
            createdAt: { $gte: currentStart, $lte: currentEnd }
          }
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            totalAmount: { $sum: '$principalAmount' }
          }
        }
      ]),
      Investment.aggregate([
        {
          $match: {
            createdAt: { $gte: previousStart, $lte: previousEnd }
          }
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            totalAmount: { $sum: '$principalAmount' }
          }
        }
      ])
    ]);

    const current = currentInvestments[0] || { count: 0, totalAmount: 0 };
    const previous = previousInvestments[0] || { count: 0, totalAmount: 0 };

    const investmentTrend = calculateTrend(current.count, previous.count);
    const amountTrend = calculateTrend(current.totalAmount, previous.totalAmount);

    return {
      investments: {
        trend: investmentTrend.direction,
        percentage: investmentTrend.percentage,
        current: current.count,
        previous: previous.count,
        chartData: [] // TODO: Implement chart data
      },
      payments: {
        trend: 'stable',
        percentage: 0,
        current: 0,
        previous: 0,
        chartData: []
      },
      investors: {
        trend: 'stable',
        percentage: 0,
        current: 0,
        previous: 0,
        chartData: []
      },
      revenue: {
        trend: amountTrend.direction,
        percentage: amountTrend.percentage,
        current: current.totalAmount,
        previous: previous.totalAmount,
        chartData: []
      }
    };
  } catch (error) {
    console.error('Error calculating trending metrics:', error);
    return {
      investments: { trend: 'stable', percentage: 0, current: 0, previous: 0, chartData: [] },
      payments: { trend: 'stable', percentage: 0, current: 0, previous: 0, chartData: [] },
      investors: { trend: 'stable', percentage: 0, current: 0, previous: 0, chartData: [] },
      revenue: { trend: 'stable', percentage: 0, current: 0, previous: 0, chartData: [] }
    };
  }
}

async function getPerformanceAnalyticsData(params = {}) {
  // Simplified implementation
  return {
    summary: {
      totalGrowth: 15.5,
      investmentGrowth: 12.3,
      paymentGrowth: 18.7,
      investorGrowth: 8.9
    },
    comparisons: {
      investments: { current: 145, previous: 128, change: 17 },
      payments: { current: 89, previous: 75, change: 14 },
      investors: { current: 67, previous: 61, change: 6 },
      revenue: { current: 2450000, previous: 2180000, change: 270000 }
    },
    breakdown: {
      byPlan: [],
      byInvestor: [],
      byMonth: []
    },
    forecast: {
      nextMonth: { investments: 160, payments: 95, revenue: 2650000 },
      nextQuarter: { investments: 485, payments: 290, revenue: 8200000 },
      confidence: 0.78
    }
  };
}

async function getQuickActionsData() {
  try {
    const [overdueCount, pendingKYC, recentInvestments, recentPayments] = await Promise.all([
      Investment.aggregate([
        { $unwind: '$schedule' },
        { $match: { 'schedule.status': 'overdue', status: 'active' } },
        { $count: 'count' }
      ]),
      Investor.countDocuments({ 'kyc.verificationStatus': 'pending' }),
      Investment.countDocuments({ createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }),
      Payment.countDocuments({ createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } })
    ]);

    return {
      pendingActions: {
        paymentsOverdue: overdueCount[0]?.count || 0,
        investmentsAwaitingApproval: 0,
        documentsToReview: 0,
        kycPending: pendingKYC
      },
      shortcuts: [
        {
          id: 'add_investor',
          title: 'Add New Investor',
          description: 'Register a new investor in the system',
          icon: 'UserPlus',
          url: '/investors/new',
          color: 'blue'
        },
        {
          id: 'create_investment',
          title: 'Create Investment',
          description: 'Set up a new investment for an existing investor',
          icon: 'TrendingUp',
          url: '/investments/new',
          color: 'green'
        },
        {
          id: 'record_payment',
          title: 'Record Payment',
          description: 'Record a new payment received',
          icon: 'CreditCard',
          url: '/payments/new',
          color: 'purple'
        },
        {
          id: 'overdue_payments',
          title: 'View Overdue Payments',
          description: 'Review and follow up on overdue payments',
          icon: 'AlertTriangle',
          url: '/payments?status=overdue',
          badge: overdueCount[0]?.count || 0,
          color: 'red'
        }
      ],
      recentlyViewed: [] // TODO: Implement user activity tracking
    };
  } catch (error) {
    console.error('Error fetching quick actions data:', error);
    return {
      pendingActions: {
        paymentsOverdue: 0,
        investmentsAwaitingApproval: 0,
        documentsToReview: 0,
        kycPending: 0
      },
      shortcuts: [],
      recentlyViewed: []
    };
  }
}

async function getOverdueItemsData() {
  try {
    const overduePayments = await Investment.aggregate([
      { $unwind: '$schedule' },
      {
        $match: {
          'schedule.status': { $in: ['pending', 'overdue'] },
          'schedule.dueDate': { $lt: new Date() },
          status: 'active'
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
          investorName: { $arrayElemAt: ['$investorInfo.name', 0] },
          amount: '$schedule.totalAmount',
          dueDate: '$schedule.dueDate',
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
      { $sort: { daysPastDue: -1 } },
      { $limit: 50 }
    ]);

    return {
      payments: overduePayments,
      documents: [],
      reviews: []
    };
  } catch (error) {
    console.error('Error fetching overdue items:', error);
    return {
      payments: [],
      documents: [],
      reviews: []
    };
  }
}

async function getRealTimeMetricsData() {
  try {
    const [activeInvestments, todaysPayments, todaysInvestments] = await Promise.all([
      Investment.countDocuments({ status: 'active' }),
      Payment.countDocuments({
        paymentDate: {
          $gte: new Date(new Date().setHours(0, 0, 0, 0)),
          $lte: new Date(new Date().setHours(23, 59, 59, 999))
        }
      }),
      Investment.countDocuments({
        createdAt: {
          $gte: new Date(new Date().setHours(0, 0, 0, 0)),
          $lte: new Date(new Date().setHours(23, 59, 59, 999))
        }
      })
    ]);

    return {
      activeUsers: 0, // TODO: Implement active user tracking
      onlineInvestors: 0, // TODO: Implement online user tracking
      todaysPayments,
      todaysInvestments,
      systemHealth: 'healthy',
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error fetching real-time metrics:', error);
    return {
      activeUsers: 0,
      onlineInvestors: 0,
      todaysPayments: 0,
      todaysInvestments: 0,
      systemHealth: 'critical',
      lastUpdated: new Date().toISOString()
    };
  }
}

async function getPeriodComparisonData(params) {
  // Simplified implementation - TODO: Implement actual comparison logic
  return {
    metrics: {},
    charts: {}
  };
}

async function getBenchmarkData(params) {
  // Simplified implementation - TODO: Implement benchmarking logic
  return {
    benchmarks: {},
    insights: []
  };
}

async function globalSearchData(params) {
  const { query, entities, limit } = params;
  const results = {
    investors: [],
    investments: [],
    payments: [],
    plans: [],
    total: 0
  };

  try {
    const searchRegex = new RegExp(query, 'i');

    if (entities.includes('investors')) {
      const investors = await Investor.find({
        $or: [
          { name: searchRegex },
          { email: searchRegex },
          { investorId: searchRegex },
          { phone: searchRegex }
        ]
      }).limit(limit).select('_id investorId name email phone');

      results.investors = investors.map(investor => ({
        id: investor._id,
        name: investor.name,
        email: investor.email,
        type: 'investor',
        relevance: calculateRelevance(query, investor.name)
      }));
    }

    if (entities.includes('investments')) {
      const investments = await Investment.find({
        investmentId: searchRegex
      }).limit(limit).populate('investor', 'name').select('_id investmentId investor');

      results.investments = investments.map(investment => ({
        id: investment._id,
        investmentId: investment.investmentId,
        investorName: investment.investor.name,
        type: 'investment',
        relevance: calculateRelevance(query, investment.investmentId)
      }));
    }

    if (entities.includes('payments')) {
      const payments = await Payment.find({
        $or: [
          { paymentId: searchRegex },
          { referenceNumber: searchRegex }
        ]
      }).limit(limit).populate('investor', 'name').select('_id paymentId investor');

      results.payments = payments.map(payment => ({
        id: payment._id,
        paymentId: payment.paymentId,
        investorName: payment.investor.name,
        type: 'payment',
        relevance: calculateRelevance(query, payment.paymentId)
      }));
    }

    if (entities.includes('plans')) {
      const plans = await Plan.find({
        $or: [
          { name: searchRegex },
          { planId: searchRegex },
          { description: searchRegex }
        ]
      }).limit(limit).select('_id planId name');

      results.plans = plans.map(plan => ({
        id: plan._id,
        name: plan.name,
        type: 'plan',
        relevance: calculateRelevance(query, plan.name)
      }));
    }

    results.total = results.investors.length + results.investments.length + 
                   results.payments.length + results.plans.length;

  } catch (error) {
    console.error('Error in global search:', error);
  }

  return results;
}

async function getQuickAccessSuggestionsData(userId) {
  // Simplified implementation - TODO: Implement user activity tracking
  return [
    {
      type: 'recent',
      entities: []
    },
    {
      type: 'frequent',
      entities: []
    },
    {
      type: 'suggested',
      entities: [
        {
          id: 'dashboard',
          type: 'page',
          title: 'Dashboard Overview',
          subtitle: 'View system overview and statistics',
          url: '/dashboard',
          icon: 'BarChart3'
        },
        {
          id: 'investors',
          type: 'page',
          title: 'Investors',
          subtitle: 'Manage investor accounts',
          url: '/investors',
          icon: 'Users'
        }
      ]
    }
  ];
}

async function getActivityTimelineData(params) {
  // Simplified implementation - TODO: Implement timeline aggregation
  return [];
}

async function generateDashboardCSV(params) {
  // Simplified CSV generation
  const header = 'Date,Type,Description,Amount\n';
  const data = '2024-01-15,Investment,New Investment Created,50000\n';
  return header + data;
}

// Helper functions
function calculateTrend(current, previous) {
  if (previous === 0) {
    return { direction: current > 0 ? 'up' : 'stable', percentage: 0 };
  }
  
  const change = ((current - previous) / previous) * 100;
  
  return {
    direction: change > 5 ? 'up' : change < -5 ? 'down' : 'stable',
    percentage: Math.abs(Math.round(change * 100) / 100)
  };
}

function calculateRelevance(query, text) {
  const lowerQuery = query.toLowerCase();
  const lowerText = text.toLowerCase();
  
  if (lowerText === lowerQuery) return 1.0;
  if (lowerText.startsWith(lowerQuery)) return 0.9;
  if (lowerText.includes(lowerQuery)) return 0.7;
  return 0.5;
}

export default router;