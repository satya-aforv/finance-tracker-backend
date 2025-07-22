// backend/routes/payments.js - Complete Payment Module with Document Upload
import express from 'express';
import { body, validationResult, query } from 'express-validator';
import Payment from '../models/Payment.js';
import Investment from '../models/Investment.js';
import Investor from '../models/Investor.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { uploadMultiple, uploadSingle, handleUploadError } from '../middleware/upload.js';

const router = express.Router();

// @route   GET /api/payments
// @desc    Get all payments with pagination and filters
// @access  Private
router.get('/', authenticate, [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('search').optional().trim(),
  query('status').optional().isIn(['pending', 'completed', 'failed', 'cancelled']),
  query('investment').optional().isMongoId().withMessage('Invalid investment ID'),
  query('investor').optional().isMongoId().withMessage('Invalid investor ID'),
  query('dateFrom').optional().isISO8601().withMessage('Invalid date format'),
  query('dateTo').optional().isISO8601().withMessage('Invalid date format')
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
  const investmentId = req.query.investment;
  const investorId = req.query.investor;
  const dateFrom = req.query.dateFrom;
  const dateTo = req.query.dateTo;

  // Build query
  let query = {};
  
  if (search) {
    query.$or = [
      { paymentId: { $regex: search, $options: 'i' } },
      { referenceNumber: { $regex: search, $options: 'i' } }
    ];
  }

  if (status) {
    query.status = status;
  }

  if (investmentId) {
    query.investment = investmentId;
  }

  if (investorId) {
    query.investor = investorId;
  }

  if (dateFrom || dateTo) {
    query.paymentDate = {};
    if (dateFrom) query.paymentDate.$gte = new Date(dateFrom);
    if (dateTo) {
      const endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
      query.paymentDate.$lte = endDate;
    }
  }

  // If user is investor role, only show their payments
  if (req.user.role === 'investor') {
    const investor = await Investor.findOne({ userId: req.user._id });
    if (investor) {
      query.investor = investor._id;
    } else {
      query.investor = null; // No payments if no investor profile
    }
  }

  const [payments, total] = await Promise.all([
    Payment.find(query)
      .populate('investment', 'investmentId principalAmount')
      .populate('investor', 'investorId name email phone')
      .populate('processedBy', 'name email')
      .populate('verifiedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Payment.countDocuments(query)
  ]);

  res.json({
    success: true,
    data: payments,
    pagination: {
      current: page,
      pages: Math.ceil(total / limit),
      total,
      limit
    }
  });
}));

// @route   GET /api/payments/:id
// @desc    Get single payment with documents
// @access  Private
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  let query = { _id: req.params.id };

  // If user is investor role, ensure they can only see their payments
  if (req.user.role === 'investor') {
    const investor = await Investor.findOne({ userId: req.user._id });
    if (investor) {
      query.investor = investor._id;
    } else {
      return res.status(404).json({ message: 'Payment not found' });
    }
  }

  const payment = await Payment.findOne(query)
    .populate('investment', 'investmentId principalAmount maturityDate')
    .populate('investor', 'investorId name email phone address')
    .populate('processedBy', 'name email')
    .populate('verifiedBy', 'name email')
    .populate('documents.uploadedBy', 'name email');

  if (!payment) {
    return res.status(404).json({ message: 'Payment not found' });
  }

  res.json({
    success: true,
    data: payment
  });
}));

// @route   POST /api/payments
// @desc    Record new payment with optional document upload
// @access  Private (Admin, Finance Manager)
router.post('/', 
  authenticate, 
  authorize('admin', 'finance_manager'),
  uploadMultiple('documents'), // Support multiple document uploads
  handleUploadError,
  [
    body('investment').isMongoId().withMessage('Valid investment ID is required'),
    body('scheduleMonth').isInt({ min: 1 }).withMessage('Schedule month must be a positive integer'),
    body('amount').isFloat({ min: 0.01 }).withMessage('Payment amount must be greater than 0'),
    body('paymentDate').optional().isISO8601().withMessage('Invalid payment date'),
    body('paymentMethod').isIn(['cash', 'cheque', 'bank_transfer', 'upi', 'card', 'other']).withMessage('Invalid payment method'),
    body('referenceNumber').optional().trim(),
    body('type').optional().isIn(['interest', 'principal', 'mixed', 'penalty', 'bonus']),
    body('interestAmount').optional().isFloat({ min: 0 }).withMessage('Interest amount must be non-negative'),
    body('principalAmount').optional().isFloat({ min: 0 }).withMessage('Principal amount must be non-negative'),
    body('penaltyAmount').optional().isFloat({ min: 0 }).withMessage('Penalty amount must be non-negative'),
    body('bonusAmount').optional().isFloat({ min: 0 }).withMessage('Bonus amount must be non-negative'),
    body('notes').optional().trim(),
    body('documentCategory').optional().isIn(['receipt', 'bank_statement', 'cheque_copy', 'upi_screenshot', 'other']),
    body('documentDescription').optional().trim()
  ], 
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }

    const {
      investment: investmentId,
      scheduleMonth,
      amount,
      paymentDate,
      paymentMethod,
      referenceNumber,
      type,
      interestAmount,
      principalAmount,
      penaltyAmount,
      bonusAmount,
      notes,
      documentCategory,
      documentDescription
    } = req.body;

    // Parse scheduleMonth to ensure it's a number
    const scheduleMonthNum = parseInt(scheduleMonth);

    // Verify investment exists and is active
    const investment = await Investment.findById(investmentId).populate('investor');
    if (!investment) {
      return res.status(404).json({ message: 'Investment not found' });
    }

    if (investment.status !== 'active') {
      return res.status(400).json({ message: 'Cannot record payment for non-active investment' });
    }

    // Debug: Log the schedule and requested month
    console.log('Investment schedule:', investment.schedule.map(s => ({ month: s.month, status: s.status })));
    console.log('Requested schedule month:', scheduleMonthNum);

    // Find schedule item - be more flexible with status checking
    const scheduleItem = investment.schedule.find(s => s.month === scheduleMonthNum);
    if (!scheduleItem) {
      return res.status(400).json({ 
        message: `Schedule month ${scheduleMonthNum} not found in investment schedule`,
        availableMonths: investment.schedule.map(s => s.month),
        debug: {
          requestedMonth: scheduleMonthNum,
          requestedType: typeof scheduleMonthNum,
          scheduleMonths: investment.schedule.map(s => ({ month: s.month, type: typeof s.month, status: s.status }))
        }
      });
    }

    // Check if this schedule month can accept payments
    // Allow payments for pending, overdue, partial, or even paid (for additional payments)
    const allowedStatuses = ['pending', 'overdue', 'partial', 'paid'];
    if (!allowedStatuses.includes(scheduleItem.status)) {
      return res.status(400).json({ 
        message: `Cannot record payment for schedule month ${scheduleMonthNum}. Status: ${scheduleItem.status}`,
        allowedStatuses,
        currentStatus: scheduleItem.status
      });
    }

    // Calculate breakdown if not provided
    let finalInterestAmount = parseFloat(interestAmount) || 0;
    let finalPrincipalAmount = parseFloat(principalAmount) || 0;
    let finalPenaltyAmount = parseFloat(penaltyAmount) || 0;
    let finalBonusAmount = parseFloat(bonusAmount) || 0;

    // Auto-calculate if breakdown not provided
    if (!interestAmount && !principalAmount && !penaltyAmount && !bonusAmount) {
      const remainingAmount = Math.max(0, scheduleItem.totalAmount - scheduleItem.paidAmount);
      const remainingInterest = Math.max(0, scheduleItem.interestAmount - Math.min(scheduleItem.paidAmount, scheduleItem.interestAmount));
      
      finalInterestAmount = Math.min(parseFloat(amount), remainingInterest);
      finalPrincipalAmount = Math.max(0, parseFloat(amount) - finalInterestAmount);
    }

    // Validate total breakdown matches amount
    const totalBreakdown = finalInterestAmount + finalPrincipalAmount + finalPenaltyAmount + finalBonusAmount;
    if (Math.abs(parseFloat(amount) - totalBreakdown) > 0.01) {
      // Auto-adjust if small difference (rounding)
      if (Math.abs(parseFloat(amount) - totalBreakdown) < 1) {
        const difference = parseFloat(amount) - totalBreakdown;
        finalInterestAmount += difference; // Add difference to interest
      } else {
        return res.status(400).json({ 
          message: 'Payment amount does not match breakdown total',
          amount: parseFloat(amount),
          breakdown: {
            interest: finalInterestAmount,
            principal: finalPrincipalAmount,
            penalty: finalPenaltyAmount,
            bonus: finalBonusAmount,
            total: totalBreakdown
          }
        });
      }
    }

    // Prepare documents array if files are uploaded
    const documents = [];
    if (req.files && req.files.length > 0) {
      req.files.forEach(file => {
        documents.push({
          category: documentCategory || 'receipt',
          fileName: file.filename,
          originalName: file.originalname,
          filePath: file.path,
          fileSize: file.size,
          mimeType: file.mimetype,
          description: documentDescription,
          uploadedBy: req.user._id,
          uploadDate: new Date()
        });
      });
    }

    try {
      // Create payment record with documents
      const payment = await Payment.create({
        investment: investmentId,
        investor: investment.investor._id,
        scheduleMonth: scheduleMonthNum,
        amount: parseFloat(amount),
        paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
        paymentMethod,
        referenceNumber,
        type: type || 'mixed',
        interestAmount: finalInterestAmount,
        principalAmount: finalPrincipalAmount,
        penaltyAmount: finalPenaltyAmount,
        bonusAmount: finalBonusAmount,
        notes,
        documents,
        processedBy: req.user._id
      });

      // Update investment schedule
      const oldStatus = scheduleItem.status;
      scheduleItem.paidAmount = (scheduleItem.paidAmount || 0) + parseFloat(amount);
      
      // Update status based on paid amount
      if (scheduleItem.paidAmount >= scheduleItem.totalAmount) {
        scheduleItem.status = 'paid';
        scheduleItem.paidDate = payment.paymentDate;
      } else if (scheduleItem.paidAmount > 0) {
        scheduleItem.status = 'partial';
      }

      // Update investment totals
      investment.updatePaymentStatus();

      // Add automatic timeline entry - Payment Received
      let timelineDescription = `Payment received: ${payment.paymentMethod.toUpperCase()} - Month ${scheduleMonthNum}`;
      if (referenceNumber) timelineDescription += ` (Ref: ${referenceNumber})`;
      if (documents.length > 0) timelineDescription += ` with ${documents.length} document(s)`;
      
      await investment.addTimelineEntry(
        'payment_received',
        timelineDescription,
        req.user._id,
        parseFloat(amount),
        {
          paymentId: payment.paymentId,
          scheduleMonth: scheduleMonthNum,
          paymentMethod,
          referenceNumber,
          documentsUploaded: documents.length,
          documentTypes: documents.map(d => d.category),
          interestAmount: finalInterestAmount,
          principalAmount: finalPrincipalAmount,
          oldScheduleStatus: oldStatus,
          newScheduleStatus: scheduleItem.status,
          breakdown: {
            interest: finalInterestAmount,
            principal: finalPrincipalAmount,
            penalty: finalPenaltyAmount,
            bonus: finalBonusAmount
          }
        }
      );

      // Add document upload timeline entries if documents were uploaded
      if (documents.length > 0) {
        await investment.addTimelineEntry(
          'document_uploaded',
          `Payment documents uploaded: ${documents.map(d => d.originalName).join(', ')}`,
          req.user._id,
          0,
          {
            paymentId: payment.paymentId,
            documentCount: documents.length,
            documentDetails: documents.map(d => ({
              category: d.category,
              fileName: d.originalName,
              fileSize: d.fileSize
            }))
          }
        );
      }

      await investment.save();

      // Update investor totals
      await Investor.findByIdAndUpdate(investment.investor._id, {
        $inc: { totalReturns: parseFloat(amount) }
      });

      // Populate for response
      await payment.populate([
        { path: 'investment', select: 'investmentId principalAmount' },
        { path: 'investor', select: 'investorId name email phone' },
        { path: 'processedBy', select: 'name email' },
        { path: 'documents.uploadedBy', select: 'name email' }
      ]);

      res.status(201).json({
        success: true,
        message: 'Payment recorded successfully',
        data: payment,
        documentsUploaded: documents.length
      });

    } catch (error) {
      console.error('Payment creation error:', error);
      return res.status(500).json({ 
        message: 'Failed to create payment',
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  })
);

// @route   PUT /api/payments/:id
// @desc    Update payment with timeline tracking
// @access  Private (Admin, Finance Manager)
router.put('/:id', authenticate, authorize('admin', 'finance_manager'), [
  body('status').optional().isIn(['pending', 'completed', 'failed', 'cancelled']),
  body('verifiedBy').optional().isMongoId().withMessage('Invalid verifier ID'),
  body('notes').optional().trim(),
  body('referenceNumber').optional().trim(),
  body('paymentMethod').optional().isIn(['cash', 'cheque', 'bank_transfer', 'upi', 'card', 'other'])
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      message: 'Validation failed', 
      errors: errors.array() 
    });
  }

  const payment = await Payment.findById(req.params.id)
    .populate('investment')
    .populate('processedBy', 'name email');
    
  if (!payment) {
    return res.status(404).json({ message: 'Payment not found' });
  }

  const { status, verifiedBy, notes, referenceNumber, paymentMethod } = req.body;
  const oldStatus = payment.status;
  const oldMethod = payment.paymentMethod;
  const oldReference = payment.referenceNumber;

  // Update fields
  if (status) payment.status = status;
  if (notes !== undefined) payment.notes = notes;
  if (referenceNumber !== undefined) payment.referenceNumber = referenceNumber;
  if (paymentMethod) payment.paymentMethod = paymentMethod;
  
  if (verifiedBy) {
    payment.verifiedBy = verifiedBy;
    payment.verifiedAt = new Date();
  }

  await payment.save();

  // Add automatic timeline entries for changes
  const investment = await Investment.findById(payment.investment._id);
  if (investment) {
    const changes = [];
    
    if (status && status !== oldStatus) {
      changes.push(`status: ${oldStatus} → ${status}`);
    }
    if (paymentMethod && paymentMethod !== oldMethod) {
      changes.push(`method: ${oldMethod} → ${paymentMethod}`);
    }
    if (referenceNumber !== undefined && referenceNumber !== oldReference) {
      changes.push(`reference: ${oldReference || 'none'} → ${referenceNumber || 'none'}`);
    }
    if (payment.verifiedBy && !payment.verifiedAt) {
      changes.push('payment verified');
    }

    if (changes.length > 0) {
      const changeDescription = `Payment ${payment.paymentId} updated: ${changes.join(', ')}`;
      
      await investment.addTimelineEntry(
        'status_changed',
        changeDescription,
        req.user._id,
        0,
        {
          paymentId: payment.paymentId,
          changes: {
            status: { old: oldStatus, new: status },
            method: { old: oldMethod, new: paymentMethod },
            reference: { old: oldReference, new: referenceNumber }
          },
          entityType: 'payment',
          verifiedBy: payment.verifiedBy,
          verifiedAt: payment.verifiedAt
        }
      );
    }
  }

  await payment.populate([
    { path: 'investment', select: 'investmentId principalAmount' },
    { path: 'investor', select: 'investorId name email phone' },
    { path: 'processedBy', select: 'name email' },
    { path: 'verifiedBy', select: 'name email' },
    { path: 'documents.uploadedBy', select: 'name email' }
  ]);

  res.json({
    success: true,
    message: 'Payment updated successfully',
    data: payment
  });
}));

// @route   POST /api/payments/:id/documents
// @desc    Upload additional documents to existing payment
// @access  Private (Admin, Finance Manager)
router.post('/:id/documents', 
  authenticate, 
  authorize('admin', 'finance_manager'),
  uploadMultiple('documents'),
  handleUploadError,
  [
    body('category').isIn(['receipt', 'bank_statement', 'cheque_copy', 'upi_screenshot', 'other']).withMessage('Invalid document category'),
    body('description').optional().trim()
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors: errors.array() 
      });
    }

    const payment = await Payment.findById(req.params.id).populate('investment');
    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }

    const { category, description } = req.body;

    // Process uploaded files
    const newDocuments = [];
    req.files.forEach(file => {
      const documentData = {
        category,
        fileName: file.filename,
        originalName: file.originalname,
        filePath: file.path,
        fileSize: file.size,
        mimeType: file.mimetype,
        description,
        uploadedBy: req.user._id,
        uploadDate: new Date()
      };

      payment.documents.push(documentData);
      newDocuments.push(documentData);
    });

    await payment.save();

    // Add timeline entry for document upload
    const investment = await Investment.findById(payment.investment._id);
    if (investment) {
      await investment.addTimelineEntry(
        'document_uploaded',
        `Additional payment documents uploaded for ${payment.paymentId}: ${newDocuments.map(d => d.originalName).join(', ')}`,
        req.user._id,
        0,
        {
          paymentId: payment.paymentId,
          documentCount: newDocuments.length,
          category,
          documentDetails: newDocuments.map(d => ({
            fileName: d.originalName,
            fileSize: d.fileSize,
            category: d.category
          }))
        }
      );
    }

    await payment.populate('documents.uploadedBy', 'name email');

    res.json({
      success: true,
      message: `${newDocuments.length} document(s) uploaded successfully`,
      data: {
        uploadedCount: newDocuments.length,
        documents: payment.documents.slice(-newDocuments.length)
      }
    });
  })
);

// @route   GET /api/payments/:id/documents
// @desc    Get all documents for a payment
// @access  Private
router.get('/:id/documents', authenticate, [
  query('category').optional().isIn(['receipt', 'bank_statement', 'cheque_copy', 'upi_screenshot', 'other'])
], asyncHandler(async (req, res) => {
  let query = { _id: req.params.id };

  // If user is investor role, ensure they can only see their payments
  if (req.user.role === 'investor') {
    const investor = await Investor.findOne({ userId: req.user._id });
    if (investor) {
      query.investor = investor._id;
    } else {
      return res.status(404).json({ message: 'Payment not found' });
    }
  }

  const payment = await Payment.findOne(query)
    .select('paymentId documents')
    .populate('documents.uploadedBy', 'name email');

  if (!payment) {
    return res.status(404).json({ message: 'Payment not found' });
  }

  let documents = payment.documents;

  // Filter by category if provided
  if (req.query.category) {
    documents = documents.filter(doc => doc.category === req.query.category);
  }

  res.json({
    success: true,
    data: {
      paymentId: payment.paymentId,
      documents,
      totalDocuments: documents.length,
      documentsByCategory: {
        receipt: payment.documents.filter(d => d.category === 'receipt').length,
        bank_statement: payment.documents.filter(d => d.category === 'bank_statement').length,
        cheque_copy: payment.documents.filter(d => d.category === 'cheque_copy').length,
        upi_screenshot: payment.documents.filter(d => d.category === 'upi_screenshot').length,
        other: payment.documents.filter(d => d.category === 'other').length
      }
    }
  });
}));

// @route   DELETE /api/payments/:id/documents/:documentId
// @desc    Delete payment document
// @access  Private (Admin, Finance Manager)
router.delete('/:id/documents/:documentId', authenticate, authorize('admin', 'finance_manager'), asyncHandler(async (req, res) => {
  const payment = await Payment.findById(req.params.id).populate('investment');
  if (!payment) {
    return res.status(404).json({ message: 'Payment not found' });
  }

  const document = payment.documents.id(req.params.documentId);
  if (!document) {
    return res.status(404).json({ message: 'Document not found' });
  }

  const documentName = document.originalName;
  payment.documents.pull(req.params.documentId);
  await payment.save();

  // Add timeline entry for document deletion
  const investment = await Investment.findById(payment.investment._id);
  if (investment) {
    await investment.addTimelineEntry(
      'document_uploaded',
      `Payment document deleted for ${payment.paymentId}: ${documentName}`,
      req.user._id,
      0,
      {
        paymentId: payment.paymentId,
        action: 'deleted',
        documentName,
        documentId: req.params.documentId
      }
    );
  }

  res.json({
    success: true,
    message: 'Document deleted successfully'
  });
}));

// @route   GET /api/payments/stats/overview
// @desc    Get payments overview stats
// @access  Private (Admin, Finance Manager)
router.get('/stats/overview', authenticate, authorize('admin', 'finance_manager'), asyncHandler(async (req, res) => {
  const [
    totalPayments,
    completedPayments,
    pendingPayments,
    totalAmount,
    thisMonthPayments,
    paymentsByMethod,
    documentsStats
  ] = await Promise.all([
    Payment.countDocuments(),
    Payment.countDocuments({ status: 'completed' }),
    Payment.countDocuments({ status: 'pending' }),
    Payment.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]),
    Payment.countDocuments({
      paymentDate: {
        $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      },
      status: 'completed'
    }),
    Payment.aggregate([
      { $match: { status: 'completed' } },
      {
        $group: {
          _id: '$paymentMethod',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ]),
    Payment.aggregate([
      { $unwind: { path: '$documents', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$documents.category',
          count: { $sum: 1 }
        }
      }
    ])
  ]);

  res.json({
    success: true,
    data: {
      totalPayments,
      completedPayments,
      pendingPayments,
      failedPayments: totalPayments - completedPayments - pendingPayments,
      totalAmount: totalAmount[0]?.total || 0,
      thisMonthPayments,
      averagePayment: completedPayments > 0 ? 
        Math.round(((totalAmount[0]?.total || 0) / completedPayments) * 100) / 100 : 0,
      paymentsByMethod,
      documentsStats: documentsStats.filter(stat => stat._id !== null)
    }
  });
}));

export default router;