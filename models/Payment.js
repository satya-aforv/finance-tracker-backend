// backend/models/Payment.js - Updated with Document Support
import mongoose from 'mongoose';

// Document Schema for Payment Documents
const paymentDocumentSchema = new mongoose.Schema({
  category: {
    type: String,
    enum: ['receipt', 'bank_statement', 'cheque_copy', 'upi_screenshot', 'other'],
    required: true
  },
  fileName: {
    type: String,
    required: true
  },
  originalName: {
    type: String,
    required: true
  },
  filePath: {
    type: String,
    required: true
  },
  fileSize: {
    type: Number,
    required: true
  },
  mimeType: {
    type: String,
    required: true
  },
  uploadDate: {
    type: Date,
    default: Date.now
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  description: {
    type: String,
    maxlength: 500
  }
});

const paymentSchema = new mongoose.Schema({
  paymentId: {
    type: String,
    unique: true
  },
  investment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Investment',
    required: [true, 'Investment is required']
  },
  investor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Investor',
    required: [true, 'Investor is required']
  },
  scheduleMonth: {
    type: Number,
    required: [true, 'Schedule month is required'],
    min: 1
  },
  amount: {
    type: Number,
    required: [true, 'Payment amount is required'],
    min: [0.01, 'Payment amount must be greater than 0']
  },
  paymentDate: {
    type: Date,
    required: [true, 'Payment date is required'],
    default: Date.now
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'cheque', 'bank_transfer', 'upi', 'card', 'other'],
    required: [true, 'Payment method is required']
  },
  referenceNumber: {
    type: String,
    trim: true
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'cancelled'],
    default: 'completed'
  },
  type: {
    type: String,
    enum: ['interest', 'principal', 'mixed', 'penalty', 'bonus'],
    default: 'mixed'
  },
  interestAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  principalAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  penaltyAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  bonusAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  notes: {
    type: String,
    maxlength: [500, 'Notes cannot be more than 500 characters']
  },
  // Enhanced document support - multiple documents per payment
  documents: [paymentDocumentSchema],
  
  // Legacy receipt field for backward compatibility
  receipt: {
    fileName: String,
    filePath: String,
    uploadDate: {
      type: Date,
      default: Date.now
    }
  },
  
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  verifiedAt: {
    type: Date,
    default: null
  },
  
  // Additional tracking fields
  lastModifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  lastModifiedAt: {
    type: Date
  },
  
  // Audit trail
  auditLog: [{
    action: {
      type: String,
      enum: ['created', 'updated', 'verified', 'document_added', 'document_removed', 'status_changed']
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    details: {
      type: mongoose.Schema.Types.Mixed
    }
  }]
}, {
  timestamps: true
});

// Generate payment ID before saving
paymentSchema.pre('save', async function(next) {
  if (!this.paymentId) {
    const count = await mongoose.models.Payment.countDocuments();
    this.paymentId = `PAY${String(count + 1).padStart(8, '0')}`;
  }
  
  // Update last modified fields
  if (this.isModified() && !this.isNew) {
    this.lastModifiedAt = new Date();
  }
  
  next();
});

// Validate amount breakdown
paymentSchema.pre('save', function(next) {
  const totalBreakdown = this.interestAmount + this.principalAmount + 
                        this.penaltyAmount + this.bonusAmount;
  
  if (Math.abs(this.amount - totalBreakdown) > 0.01) {
    return next(new Error('Payment amount does not match the sum of breakdown amounts'));
  }
  
  next();
});

// Method to add document
paymentSchema.methods.addDocument = function(documentData, uploadedBy) {
  const document = {
    ...documentData,
    uploadedBy,
    uploadDate: new Date()
  };
  
  this.documents.push(document);
  
  // Add to audit log
  this.auditLog.push({
    action: 'document_added',
    performedBy: uploadedBy,
    details: {
      documentCategory: documentData.category,
      fileName: documentData.originalName,
      fileSize: documentData.fileSize
    }
  });
  
  return this.save();
};

// Method to remove document
paymentSchema.methods.removeDocument = function(documentId, removedBy) {
  const document = this.documents.id(documentId);
  if (!document) {
    throw new Error('Document not found');
  }
  
  const documentName = document.originalName;
  this.documents.pull(documentId);
  
  // Add to audit log
  this.auditLog.push({
    action: 'document_removed',
    performedBy: removedBy,
    details: {
      documentName,
      documentId
    }
  });
  
  return this.save();
};

// Method to update status with audit trail
paymentSchema.methods.updateStatus = function(newStatus, updatedBy, reason) {
  const oldStatus = this.status;
  this.status = newStatus;
  this.lastModifiedBy = updatedBy;
  this.lastModifiedAt = new Date();
  
  // Add to audit log
  this.auditLog.push({
    action: 'status_changed',
    performedBy: updatedBy,
    details: {
      oldStatus,
      newStatus,
      reason
    }
  });
  
  return this.save();
};

// Method to verify payment
paymentSchema.methods.verifyPayment = function(verifiedBy, notes) {
  this.verifiedBy = verifiedBy;
  this.verifiedAt = new Date();
  this.lastModifiedBy = verifiedBy;
  this.lastModifiedAt = new Date();
  
  if (notes) {
    this.notes = this.notes ? `${this.notes}\n\nVerification Notes: ${notes}` : `Verification Notes: ${notes}`;
  }
  
  // Add to audit log
  this.auditLog.push({
    action: 'verified',
    performedBy: verifiedBy,
    details: {
      verificationNotes: notes
    }
  });
  
  return this.save();
};

// Method to get documents by category
paymentSchema.methods.getDocumentsByCategory = function(category) {
  return this.documents.filter(doc => doc.category === category);
};

// Method to get document summary
paymentSchema.methods.getDocumentSummary = function() {
  const summary = {
    total: this.documents.length,
    byCategory: {}
  };
  
  this.documents.forEach(doc => {
    summary.byCategory[doc.category] = (summary.byCategory[doc.category] || 0) + 1;
  });
  
  return summary;
};

// Virtual to check if payment has all required documents
paymentSchema.virtual('hasRequiredDocuments').get(function() {
  const requiredCategories = ['receipt']; // Basic requirement
  
  // Additional requirements based on payment method
  if (this.paymentMethod === 'cheque') {
    requiredCategories.push('cheque_copy');
  } else if (this.paymentMethod === 'bank_transfer') {
    requiredCategories.push('bank_statement');
  } else if (this.paymentMethod === 'upi') {
    requiredCategories.push('upi_screenshot');
  }
  
  return requiredCategories.every(category => 
    this.documents.some(doc => doc.category === category)
  );
});

// Virtual to get payment summary
paymentSchema.virtual('paymentSummary').get(function() {
  return {
    id: this.paymentId,
    amount: this.amount,
    method: this.paymentMethod,
    status: this.status,
    hasDocuments: this.documents.length > 0,
    isVerified: !!this.verifiedBy,
    breakdown: {
      interest: this.interestAmount,
      principal: this.principalAmount,
      penalty: this.penaltyAmount,
      bonus: this.bonusAmount
    }
  };
});

// Static method to get payment statistics
paymentSchema.statics.getStatistics = async function(dateRange = {}) {
  const matchStage = { status: 'completed' };
  
  if (dateRange.start || dateRange.end) {
    matchStage.paymentDate = {};
    if (dateRange.start) matchStage.paymentDate.$gte = new Date(dateRange.start);
    if (dateRange.end) matchStage.paymentDate.$lte = new Date(dateRange.end);
  }
  
  const [summary, byMethod, byStatus] = await Promise.all([
    this.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalPayments: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          avgAmount: { $avg: '$amount' },
          totalInterest: { $sum: '$interestAmount' },
          totalPrincipal: { $sum: '$principalAmount' }
        }
      }
    ]),
    this.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$paymentMethod',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ]),
    this.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ])
  ]);
  
  return {
    summary: summary[0] || {},
    byMethod,
    byStatus
  };
};

// Index for better performance
paymentSchema.index({ investment: 1 });
paymentSchema.index({ investor: 1 });
paymentSchema.index({ paymentDate: 1 });
paymentSchema.index({ status: 1 });
paymentSchema.index({ scheduleMonth: 1 });
paymentSchema.index({ paymentMethod: 1 });
paymentSchema.index({ 'documents.category': 1 });
paymentSchema.index({ createdAt: -1 });

export default mongoose.model('Payment', paymentSchema);