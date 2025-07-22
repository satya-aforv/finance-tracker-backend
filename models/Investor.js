// backend/models/Investor.js - UPDATED WITH UTILITY METHODS
import mongoose from 'mongoose';

const kycSchema = new mongoose.Schema({
  panNumber: {
    type: String,
    required: [true, 'PAN number is required'],
    uppercase: true,
    match: [/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Please enter a valid PAN number']
  },
  aadharNumber: {
    type: String,
    required: [true, 'Aadhar number is required'],
    match: [/^\d{12}$/, 'Please enter a valid 12-digit Aadhar number']
  },
  bankDetails: {
    accountNumber: {
      type: String,
      required: [true, 'Account number is required']
    },
    ifscCode: {
      type: String,
      required: [true, 'IFSC code is required'],
      uppercase: true,
      match: [/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Please enter a valid IFSC code']
    },
    bankName: {
      type: String,
      required: [true, 'Bank name is required']
    },
    branchName: {
      type: String,
      required: [true, 'Branch name is required']
    }
  },
  documents: {
    panCard: String,
    aadharCard: String,
    bankStatement: String,
    signature: String
  },
  verificationStatus: {
    type: String,
    enum: ['pending', 'verified', 'rejected'],
    default: 'pending'
  },
  verifiedAt: Date,
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
});

const investorSchema = new mongoose.Schema({
  investorId: {
    type: String,
    unique: true
  },
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [100, 'Name cannot be more than 100 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    match: [/^[6-9]\d{9}$/, 'Please enter a valid 10-digit phone number']
  },
  address: {
    street: String,
    city: String,
    state: String,
    pincode: {
      type: String,
      match: [/^\d{6}$/, 'Please enter a valid 6-digit pincode']
    },
    country: {
      type: String,
      default: 'India'
    }
  },
  kyc: {
    type: kycSchema,
    required: [true, 'KYC details are required']
  },
  agreements: [{
    fileName: String,
    filePath: String,
    uploadDate: {
      type: Date,
      default: Date.now
    },
    category: {
      type: String,
      enum: ['agreement', 'kyc', 'legal', 'other'],
      default: 'agreement'
    },
    description: String
  }],
  totalInvestment: {
    type: Number,
    default: 0,
    min: [0, 'Total investment cannot be negative']
  },
  activeInvestments: {
    type: Number,
    default: 0,
    min: [0, 'Active investments cannot be negative']
  },
  totalReturns: {
    type: Number,
    default: 0,
    min: [0, 'Total returns cannot be negative']
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'blocked'],
    default: 'active'
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Enhanced fields
  riskProfile: {
    type: String,
    enum: ['conservative', 'moderate', 'aggressive'],
    default: 'moderate'
  },
  investmentExperience: {
    type: String,
    enum: ['beginner', 'intermediate', 'expert'],
    default: 'beginner'
  },
  preferredContactMethod: {
    type: String,
    enum: ['email', 'phone', 'sms'],
    default: 'email'
  },
  notes: {
    type: String,
    maxlength: [1000, 'Notes cannot exceed 1000 characters']
  },
  tags: [String],
  lastContactDate: Date,
  nextFollowUpDate: Date
}, {
  timestamps: true
});

// Generate investor ID before saving
investorSchema.pre('save', async function(next) {
  if (!this.investorId) {
    const count = await mongoose.models.Investor.countDocuments();
    this.investorId = `INV${String(count + 1).padStart(6, '0')}`;
  }
  next();
});

// UTILITY METHODS

// Calculate total ROI for investor
investorSchema.methods.calculateTotalROI = function() {
  if (this.totalInvestment === 0) return 0;
  return Number(((this.totalReturns / this.totalInvestment) * 100).toFixed(2));
};

// Get active investments count
investorSchema.methods.getActiveInvestmentsCount = async function() {
  const Investment = mongoose.model('Investment');
  return await Investment.countDocuments({ 
    investor: this._id, 
    status: 'active' 
  });
};

// Calculate pending payments
investorSchema.methods.getPendingPayments = async function() {
  const Investment = mongoose.model('Investment');
  const investments = await Investment.find({ 
    investor: this._id, 
    status: 'active' 
  });
  
  let pendingAmount = 0;
  investments.forEach(inv => {
    pendingAmount += inv.remainingAmount || 0;
  });
  
  return Number(pendingAmount.toFixed(2));
};

// Get investment summary
investorSchema.methods.getInvestmentSummary = async function() {
  const Investment = mongoose.model('Investment');
  const Payment = mongoose.model('Payment');
  
  const [investments, payments] = await Promise.all([
    Investment.find({ investor: this._id }),
    Payment.find({ investor: this._id })
  ]);
  
  const summary = {
    totalInvestments: investments.length,
    activeInvestments: investments.filter(inv => inv.status === 'active').length,
    completedInvestments: investments.filter(inv => inv.status === 'completed').length,
    totalInvested: investments.reduce((sum, inv) => sum + inv.principalAmount, 0),
    totalReturns: payments.reduce((sum, pay) => sum + pay.amount, 0),
    totalExpectedReturns: investments.reduce((sum, inv) => sum + inv.totalExpectedReturns, 0),
    avgInvestmentSize: investments.length > 0 ? 
      investments.reduce((sum, inv) => sum + inv.principalAmount, 0) / investments.length : 0,
    roi: this.calculateTotalROI()
  };
  
  return summary;
};

// Get overdue payments
investorSchema.methods.getOverduePayments = async function() {
  const Investment = mongoose.model('Investment');
  const investments = await Investment.find({ 
    investor: this._id, 
    status: 'active' 
  });
  
  const overduePayments = [];
  const now = new Date();
  
  investments.forEach(investment => {
    investment.schedule.forEach(scheduleItem => {
      if (scheduleItem.status === 'overdue' || 
          (scheduleItem.status === 'pending' && scheduleItem.dueDate < now)) {
        overduePayments.push({
          investmentId: investment.investmentId,
          month: scheduleItem.month,
          dueDate: scheduleItem.dueDate,
          amount: scheduleItem.totalAmount,
          daysPastDue: Math.ceil((now - scheduleItem.dueDate) / (1000 * 60 * 60 * 24))
        });
      }
    });
  });
  
  return overduePayments.sort((a, b) => b.daysPastDue - a.daysPastDue);
};

// Get upcoming payments
investorSchema.methods.getUpcomingPayments = async function(days = 30) {
  const Investment = mongoose.model('Investment');
  const investments = await Investment.find({ 
    investor: this._id, 
    status: 'active' 
  });
  
  const upcomingPayments = [];
  const now = new Date();
  const futureDate = new Date(now.getTime() + (days * 24 * 60 * 60 * 1000));
  
  investments.forEach(investment => {
    investment.schedule.forEach(scheduleItem => {
      if (scheduleItem.status === 'pending' && 
          scheduleItem.dueDate >= now && 
          scheduleItem.dueDate <= futureDate) {
        upcomingPayments.push({
          investmentId: investment.investmentId,
          month: scheduleItem.month,
          dueDate: scheduleItem.dueDate,
          amount: scheduleItem.totalAmount,
          daysUntilDue: Math.ceil((scheduleItem.dueDate - now) / (1000 * 60 * 60 * 24))
        });
      }
    });
  });
  
  return upcomingPayments.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
};

// Get portfolio performance
investorSchema.methods.getPortfolioPerformance = async function() {
  const Investment = mongoose.model('Investment');
  const investments = await Investment.find({ investor: this._id })
    .populate('plan', 'name interestRate');
  
  const performance = {
    totalValue: 0,
    currentValue: 0,
    unrealizedGains: 0,
    realizedGains: this.totalReturns,
    investmentBreakdown: {}
  };
  
  investments.forEach(investment => {
    const planName = investment.plan.name;
    
    if (!performance.investmentBreakdown[planName]) {
      performance.investmentBreakdown[planName] = {
        count: 0,
        totalInvested: 0,
        currentValue: 0,
        returns: 0
      };
    }
    
    performance.investmentBreakdown[planName].count++;
    performance.investmentBreakdown[planName].totalInvested += investment.principalAmount;
    performance.investmentBreakdown[planName].currentValue += 
      (investment.totalExpectedReturns - investment.remainingAmount);
    
    performance.totalValue += investment.totalExpectedReturns;
    performance.currentValue += (investment.totalExpectedReturns - investment.remainingAmount);
  });
  
  performance.unrealizedGains = performance.currentValue - this.totalInvestment;
  
  return performance;
};

// Check if investor needs follow-up
investorSchema.methods.needsFollowUp = function() {
  if (!this.nextFollowUpDate) return false;
  return new Date() >= this.nextFollowUpDate;
};

// Update statistics
investorSchema.methods.updateStatistics = async function() {
  const Investment = mongoose.model('Investment');
  const Payment = mongoose.model('Payment');
  
  const [investments, payments] = await Promise.all([
    Investment.find({ investor: this._id }),
    Payment.find({ investor: this._id, status: 'completed' })
  ]);
  
  this.totalInvestment = investments.reduce((sum, inv) => sum + inv.principalAmount, 0);
  this.activeInvestments = investments.filter(inv => inv.status === 'active').length;
  this.totalReturns = payments.reduce((sum, pay) => sum + pay.amount, 0);
  
  return this.save();
};

// VIRTUAL FIELDS
investorSchema.virtual('fullAddress').get(function() {
  const addr = this.address;
  if (!addr.street) return '';
  
  return [addr.street, addr.city, addr.state, addr.pincode, addr.country]
    .filter(Boolean)
    .join(', ');
});

investorSchema.virtual('isKYCComplete').get(function() {
  return this.kyc && 
         this.kyc.panNumber && 
         this.kyc.aadharNumber && 
         this.kyc.bankDetails.accountNumber &&
         this.kyc.verificationStatus === 'verified';
});

// STATIC METHODS
investorSchema.statics.getInvestorStats = async function() {
  const stats = await this.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalInvestment: { $sum: '$totalInvestment' },
        totalReturns: { $sum: '$totalReturns' },
        avgInvestment: { $avg: '$totalInvestment' }
      }
    }
  ]);
  
  return stats;
};

investorSchema.statics.getTopInvestors = async function(limit = 10) {
  return this.find({ status: 'active' })
    .sort({ totalInvestment: -1 })
    .limit(limit)
    .select('investorId name totalInvestment totalReturns');
};

investorSchema.statics.searchInvestors = function(searchTerm) {
  const regex = new RegExp(searchTerm, 'i');
  return this.find({
    $or: [
      { name: regex },
      { email: regex },
      { investorId: regex },
      { phone: regex }
    ]
  });
};

// INDEXES FOR PERFORMANCE
investorSchema.index({ email: 1 });
investorSchema.index({ 'kyc.panNumber': 1 });
investorSchema.index({ 'kyc.aadharNumber': 1 });
investorSchema.index({ status: 1 });
investorSchema.index({ investorId: 1 });
investorSchema.index({ userId: 1 });
investorSchema.index({ createdAt: -1 });
investorSchema.index({ totalInvestment: -1 });
investorSchema.index({ riskProfile: 1 });

export default mongoose.model('Investor', investorSchema);