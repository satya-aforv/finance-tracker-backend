// backend/models/Investment.js - Simplified Investment Model
import mongoose from 'mongoose';

const scheduleSchema = new mongoose.Schema({
  month: {
    type: Number,
    required: true,
    min: 1
  },
  dueDate: {
    type: Date,
    required: true
  },
  interestAmount: {
    type: Number,
    required: true,
    min: 0
  },
  principalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  remainingPrincipal: {
    type: Number,
    required: true,
    min: 0
  },
  status: {
    type: String,
    enum: ['pending', 'paid', 'overdue', 'partial'],
    default: 'pending'
  },
  paidAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  paidDate: {
    type: Date,
    default: null
  }
});

// Timeline/Activity Log Schema
const timelineSchema = new mongoose.Schema({
  date: {
    type: Date,
    default: Date.now
  },
  type: {
    type: String,
    enum: ['investment_created', 'payment_received', 'payment_overdue', 'document_uploaded', 'status_changed', 'note_added', 'schedule_updated'],
    required: true
  },
  description: {
    type: String,
    required: true
  },
  amount: {
    type: Number,
    default: 0
  },
  performedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
});

// Document Schema with categories
const documentSchema = new mongoose.Schema({
  category: {
    type: String,
    enum: ['agreement', 'kyc', 'payment_proof', 'communication', 'legal', 'other'],
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
  },
  isActive: {
    type: Boolean,
    default: true
  }
});

const investmentSchema = new mongoose.Schema({
  investmentId: {
    type: String,
    unique: true
  },
  investor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Investor',
    required: [true, 'Investor is required']
  },
  plan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Plan',
    required: [true, 'Plan is required']
  },
  
  // Basic Investment Details
  principalAmount: {
    type: Number,
    required: [true, 'Principal amount is required'],
    min: [1000, 'Principal amount cannot be less than 1000']
  },
  investmentDate: {
    type: Date,
    required: [true, 'Investment date is required'],
    default: Date.now
  },
  maturityDate: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'completed', 'closed', 'defaulted'],
    default: 'active'
  },
  
  // Financial Details (copied from plan for historical record)
  interestRate: {
    type: Number,
    required: true,
    min: 0
  },
  interestType: {
    type: String,
    enum: ['flat', 'reducing'],
    required: true
  },
  tenure: {
    type: Number,
    required: true,
    min: 1
  },
  paymentType: {
    type: String,
    enum: ['interest', 'interestWithPrincipal'],
    required: true
  },
  
  // Calculated Fields
  totalExpectedReturns: {
    type: Number,
    required: true,
    min: 0
  },
  totalInterestExpected: {
    type: Number,
    required: true,
    min: 0
  },
  totalPaidAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  totalInterestPaid: {
    type: Number,
    default: 0,
    min: 0
  },
  totalPrincipalPaid: {
    type: Number,
    default: 0,
    min: 0
  },
  remainingAmount: {
    type: Number,
    required: true,
    min: 0
  },
  
  // Payment Schedule
  schedule: [scheduleSchema],
  
  // Document management
  documents: [documentSchema],
  
  // Timeline/Activity log
  timeline: [timelineSchema],
  
  notes: {
    type: String,
    maxlength: [1000, 'Notes cannot be more than 1000 characters']
  },
  
  // Risk assessment
  riskAssessment: {
    score: {
      type: Number,
      min: 1,
      max: 10,
      default: 5
    },
    factors: [String],
    lastUpdated: Date
  },
  
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Generate investment ID before saving
investmentSchema.pre('save', async function(next) {
  if (!this.investmentId) {
    const count = await mongoose.models.Investment.countDocuments();
    this.investmentId = `INVST${String(count + 1).padStart(6, '0')}`;
  }
  
  // Add creation to timeline
  if (this.isNew) {
    this.timeline.push({
      type: 'investment_created',
      description: `Investment created for amount ${this.principalAmount}`,
      amount: this.principalAmount,
      performedBy: this.createdBy,
      metadata: {
        planId: this.plan,
        investorId: this.investor
      }
    });
  }
  
  next();
});

// Generate payment schedule based on plan configuration
investmentSchema.methods.generateSchedule = function() {
  const schedule = [];
  let remainingPrincipal = this.principalAmount;
  const startDate = new Date(this.investmentDate);
  const monthlyRate = this.interestRate / 100;

  if (this.paymentType === 'interest') {
    return this.generateInterestSchedule(startDate, monthlyRate);
  } else {
    return this.generateInterestWithPrincipalSchedule(startDate, monthlyRate);
  }
};

// Generate interest-only schedule
investmentSchema.methods.generateInterestSchedule = function(startDate, monthlyRate) {
  const schedule = [];
  let remainingPrincipal = this.principalAmount;
  
  for (let month = 1; month <= this.tenure; month++) {
    const dueDate = new Date(startDate);
    dueDate.setMonth(dueDate.getMonth() + month);
    
    let interestAmount = 0;
    let principalAmount = 0;
    
    if (this.interestType === 'flat') {
      interestAmount = this.principalAmount * monthlyRate;
    } else {
      interestAmount = remainingPrincipal * monthlyRate;
    }
    
    // Principal repayment logic would be based on plan configuration
    // For simplicity, principal at the end
    if (month === this.tenure) {
      principalAmount = remainingPrincipal;
      remainingPrincipal = 0;
    }
    
    schedule.push({
      month,
      dueDate,
      interestAmount: Math.round(interestAmount * 100) / 100,
      principalAmount: Math.round(principalAmount * 100) / 100,
      totalAmount: Math.round((interestAmount + principalAmount) * 100) / 100,
      remainingPrincipal: Math.round(remainingPrincipal * 100) / 100,
      status: 'pending',
      paidAmount: 0,
      paidDate: null
    });
  }
  
  return schedule;
};

// Generate interest with principal schedule
investmentSchema.methods.generateInterestWithPrincipalSchedule = function(startDate, monthlyRate) {
  const schedule = [];
  let remainingPrincipal = this.principalAmount;
  
  // Simplified: equal principal + interest each month
  const monthlyPrincipal = this.principalAmount / this.tenure;
  
  for (let month = 1; month <= this.tenure; month++) {
    const dueDate = new Date(startDate);
    dueDate.setMonth(dueDate.getMonth() + month);
    
    let interestAmount = 0;
    let principalAmount = monthlyPrincipal;
    
    if (this.interestType === 'flat') {
      interestAmount = this.principalAmount * monthlyRate;
    } else {
      interestAmount = remainingPrincipal * monthlyRate;
    }
    
    remainingPrincipal -= principalAmount;
    
    schedule.push({
      month,
      dueDate,
      interestAmount: Math.round(interestAmount * 100) / 100,
      principalAmount: Math.round(principalAmount * 100) / 100,
      totalAmount: Math.round((interestAmount + principalAmount) * 100) / 100,
      remainingPrincipal: Math.round(Math.max(0, remainingPrincipal) * 100) / 100,
      status: 'pending',
      paidAmount: 0,
      paidDate: null
    });
  }
  
  return schedule;
};

// Add document method
investmentSchema.methods.addDocument = function(documentData, uploadedBy) {
  const document = {
    ...documentData,
    uploadedBy
  };
  
  this.documents.push(document);
  
  // Add to timeline
  this.timeline.push({
    type: 'document_uploaded',
    description: `Document uploaded: ${documentData.originalName}`,
    performedBy: uploadedBy,
    metadata: {
      category: documentData.category,
      fileName: documentData.fileName
    }
  });
  
  return this.save();
};

// Add timeline entry method
investmentSchema.methods.addTimelineEntry = function(type, description, performedBy, amount = 0, metadata = {}) {
  this.timeline.push({
    type,
    description,
    amount,
    performedBy,
    metadata
  });
  
  return this.save();
};

// Get documents by category
investmentSchema.methods.getDocumentsByCategory = function(category) {
  return this.documents.filter(doc => doc.category === category && doc.isActive);
};

// Update payment status method
investmentSchema.methods.updatePaymentStatus = function() {
  const now = new Date();
  let totalPaid = 0;
  let totalInterestPaid = 0;
  let totalPrincipalPaid = 0;
  let statusChanged = false;

  this.schedule.forEach(payment => {
    const oldStatus = payment.status;
    
    if (payment.status === 'paid') {
      totalPaid += payment.paidAmount;
      totalInterestPaid += Math.min(payment.paidAmount, payment.interestAmount);
      totalPrincipalPaid += Math.max(0, payment.paidAmount - payment.interestAmount);
    } else if (payment.status === 'partial') {
      totalPaid += payment.paidAmount;
      totalInterestPaid += Math.min(payment.paidAmount, payment.interestAmount);
      totalPrincipalPaid += Math.max(0, payment.paidAmount - payment.interestAmount);
    }

    // Update overdue status
    if (payment.status === 'pending' && payment.dueDate < now) {
      payment.status = 'overdue';
      statusChanged = true;
    }
  });

  this.totalPaidAmount = totalPaid;
  this.totalInterestPaid = totalInterestPaid;
  this.totalPrincipalPaid = totalPrincipalPaid;
  this.remainingAmount = this.totalExpectedReturns - totalPaid;

  // Update investment status
  const oldInvestmentStatus = this.status;
  if (this.remainingAmount <= 0) {
    this.status = 'completed';
  }
  
  // Add timeline entry for status changes
  if (statusChanged || oldInvestmentStatus !== this.status) {
    this.timeline.push({
      type: 'status_changed',
      description: `Investment status updated to ${this.status}`,
      performedBy: this.createdBy,
      metadata: {
        oldStatus: oldInvestmentStatus,
        newStatus: this.status
      }
    });
  }
};

// Index for better performance
investmentSchema.index({ investor: 1 });
investmentSchema.index({ plan: 1 });
investmentSchema.index({ status: 1 });
investmentSchema.index({ investmentDate: 1 });
investmentSchema.index({ maturityDate: 1 });
investmentSchema.index({ paymentType: 1 });
investmentSchema.index({ 'documents.category': 1 });
investmentSchema.index({ 'documents.isActive': 1 });
investmentSchema.index({ 'timeline.type': 1 });
investmentSchema.index({ 'timeline.date': 1 });

export default mongoose.model('Investment', investmentSchema);