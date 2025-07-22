import mongoose from 'mongoose';

const settingsSchema = new mongoose.Schema({
  company: {
    name: {
      type: String,
      required: [true, 'Company name is required'],
      default: 'FinanceTracker Pro'
    },
    logo: {
      type: String,
      default: null
    },
    email: {
      type: String,
      required: [true, 'Company email is required'],
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
    },
    phone: {
      type: String,
      required: [true, 'Company phone is required']
    },
    address: {
      street: String,
      city: String,
      state: String,
      pincode: String,
      country: {
        type: String,
        default: 'India'
      }
    },
    website: String,
    taxId: String,
    registrationNumber: String
  },
  financial: {
    defaultCurrency: {
      type: String,
      default: 'INR'
    },
    currencySymbol: {
      type: String,
      default: '₹'
    },
    financialYearStart: {
      type: String,
      default: 'April',
      enum: ['January', 'April', 'July', 'October']
    },
    interestCalculationMethod: {
      type: String,
      default: 'daily',
      enum: ['daily', 'monthly', 'yearly']
    },
    defaultLateFee: {
      type: Number,
      default: 2,
      min: 0,
      max: 10
    },
    gracePeriodDays: {
      type: Number,
      default: 7,
      min: 0,
      max: 30
    }
  },
  notifications: {
    emailEnabled: {
      type: Boolean,
      default: true
    },
    smsEnabled: {
      type: Boolean,
      default: false
    },
    paymentReminders: {
      enabled: {
        type: Boolean,
        default: true
      },
      daysBefore: {
        type: Number,
        default: 3,
        min: 1,
        max: 30
      }
    },
    overdueAlerts: {
      enabled: {
        type: Boolean,
        default: true
      },
      frequency: {
        type: String,
        default: 'weekly',
        enum: ['daily', 'weekly', 'monthly']
      }
    },
    investmentMaturity: {
      enabled: {
        type: Boolean,
        default: true
      },
      daysBefore: {
        type: Number,
        default: 30,
        min: 1,
        max: 90
      }
    }
  },
  security: {
    passwordPolicy: {
      minLength: {
        type: Number,
        default: 8,
        min: 6,
        max: 20
      },
      requireUppercase: {
        type: Boolean,
        default: true
      },
      requireLowercase: {
        type: Boolean,
        default: true
      },
      requireNumbers: {
        type: Boolean,
        default: true
      },
      requireSpecialChars: {
        type: Boolean,
        default: true
      }
    },
    sessionTimeout: {
      type: Number,
      default: 60,
      min: 15,
      max: 480
    },
    maxLoginAttempts: {
      type: Number,
      default: 5,
      min: 3,
      max: 10
    },
    twoFactorAuth: {
      type: Boolean,
      default: false
    }
  },
  backup: {
    enabled: {
      type: Boolean,
      default: true
    },
    frequency: {
      type: String,
      default: 'daily',
      enum: ['daily', 'weekly', 'monthly']
    },
    retentionDays: {
      type: Number,
      default: 30,
      min: 7,
      max: 365
    }
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Ensure only one settings document exists
settingsSchema.statics.getSingleton = async function() {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({
      updatedBy: null // This will be set by the application
    });
  }
  return settings;
};

export default mongoose.model('Settings', settingsSchema);