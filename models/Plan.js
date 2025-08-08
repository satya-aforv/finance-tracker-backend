// backend/models/Plan.js - Simplified Plan Model matching HTML form
import mongoose from "mongoose";

const planSchema = new mongoose.Schema(
  {
    planId: {
      type: String,
      unique: true,
    },
    name: {
      type: String,
      required: [true, "Plan name is required"],
      trim: true,
      maxlength: [100, "Plan name cannot be more than 100 characters"],
    },
    description: {
      type: String,
      maxlength: [500, "Description cannot be more than 500 characters"],
    },

    // Basic Plan Configuration
    interestRate: {
      type: Number,
      required: [true, "Interest rate is required"],
      min: [0, "Interest rate cannot be negative"],
      max: [100, "Interest rate cannot exceed 100%"],
    },
    interestType: {
      type: String,
      enum: ["flat", "reducing"],
      required: [true, "Interest type is required"],
    },
    tenure: {
      type: Number,
      required: [true, "Investment tenure is required"],
      min: [1, "Tenure must be at least 1 month"],
      max: [240, "Tenure cannot exceed 240 months"],
    },
    minInvestment: {
      type: Number,
      required: [true, "Minimum investment amount is required"],
      min: [1000, "Minimum investment cannot be less than 1000"],
    },
    maxInvestment: {
      type: Number,
      required: [true, "Maximum investment amount is required"],
      validate: {
        validator: function (value) {
          return value >= this.minInvestment;
        },
        message: "Maximum investment must be greater than minimum investment",
      },
    },

    // Payment Type Selection (matches HTML form)
    paymentType: {
      type: String,
      enum: ["interest", "interestWithPrincipal"],
      required: [true, "Payment type is required"],
    },

    // Interest Payment Configuration
    interestPayment: {
      dateOfInvestment: {
        type: Date,
        required: function () {
          return this.paymentType === "interest";
        },
      },
      amountInvested: {
        type: Number,
        required: function () {
          return this.paymentType === "interest";
        },
      },
      interestFrequency: {
        type: String,
        enum: ["monthly", "quarterly", "half-yearly", "yearly", "others"],
        required: function () {
          return this.paymentType === "interest";
        },
      },
      interestStartDate: {
        type: Date,
        required: function () {
          return (
            this.paymentType === "interest" &&
            this.interestPayment?.interestFrequency === "others"
          );
        },
      },
      principalRepaymentOption: {
        type: String,
        enum: ["fixed", "flexible"],
        required: function () {
          return this.paymentType === "interest";
        },
      },
      withdrawalAfterPercentage: {
        type: Number,
        min: 0,
        max: 100,
        required: function () {
          return (
            this.paymentType === "interest" &&
            this.interestPayment?.principalRepaymentOption === "flexible"
          );
        },
      },
      principalSettlementTerm: {
        type: Number,
        min: 1,
        required: function () {
          return (
            this.paymentType === "interest" &&
            this.interestPayment?.principalRepaymentOption === "flexible"
          );
        },
      },
    },

    // Interest with Principal Payment Configuration
    interestWithPrincipalPayment: {
      dateOfInvestment: {
        type: Date,
        required: function () {
          return this.paymentType === "interestWithPrincipal";
        },
      },
      investedAmount: {
        type: Number,
        required: function () {
          return this.paymentType === "interestWithPrincipal";
        },
      },
      principalRepaymentPercentage: {
        type: Number,
        required: function () {
          return this.paymentType === "interestWithPrincipal";
        },
        min: 0,
        max: 100,
      },
      paymentFrequency: {
        type: String,
        enum: ["monthly", "quarterly", "half-yearly", "yearly", "others"],
        required: function () {
          return this.paymentType === "interestWithPrincipal";
        },
      },
      interestPayoutDate: {
        type: Date,
        required: function () {
          return (
            this.paymentType === "interestWithPrincipal" &&
            this.interestWithPrincipalPayment?.paymentFrequency === "others"
          );
        },
      },
      principalPayoutDate: {
        type: Date,
        required: function () {
          return (
            this.paymentType === "interestWithPrincipal" &&
            this.interestWithPrincipalPayment?.paymentFrequency === "others"
          );
        },
      },
    },

    isActive: {
      type: Boolean,
      default: true,
    },
    features: [
      {
        type: String,
        trim: true,
      },
    ],
    riskLevel: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
    totalInvestors: {
      type: Number,
      default: 0,
      min: [0, "Total investors cannot be negative"],
    },
    totalInvestment: {
      type: Number,
      default: 0,
      min: [0, "Total investment cannot be negative"],
    },
    planType: {
      type: String,
      enum: ["custom", "admin"],
      default: "admin",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Generate plan ID before saving
planSchema.pre("save", async function (next) {
  if (!this.planId) {
    const count = await mongoose.models.Plan.countDocuments();
    this.planId = `PLAN${String(count + 1).padStart(4, "0")}`;
  }
  next();
});

// Calculate expected returns method
planSchema.methods.calculateExpectedReturns = function (principalAmount) {
  const monthlyRate = this.interestRate / 100;
  let totalInterest = 0;

  if (this.paymentType === "interest") {
    return this.calculateInterestOnlyReturns(principalAmount, monthlyRate);
  } else {
    return this.calculateInterestWithPrincipalReturns(
      principalAmount,
      monthlyRate
    );
  }
};

// Interest-only calculation
planSchema.methods.calculateInterestOnlyReturns = function (
  principalAmount,
  monthlyRate
) {
  let totalInterest = 0;
  let remainingPrincipal = principalAmount;

  const tenure = this.tenure || 0;
  const repaymentOption =
    this.interestPayment?.principalRepaymentOption || "fixed";
  const withdrawalAfterPercentage =
    this.interestPayment?.withdrawalAfterPercentage || 0;
  const principalSettlementTerm =
    this.interestPayment?.principalSettlementTerm || tenure;

  if (this.interestType === "flat" || repaymentOption === "fixed") {
    // Flat or fixed repayment: interest on full principal for entire tenure
    totalInterest = principalAmount * monthlyRate * tenure;
  } else {
    // Reducing balance with flexible withdrawal
    const settlementStartMonth = Math.ceil(
      (tenure * withdrawalAfterPercentage) / 100
    );
    const monthlyPrincipalRepayment = principalAmount / principalSettlementTerm;

    for (let month = 1; month <= tenure; month++) {
      totalInterest += remainingPrincipal * monthlyRate;

      if (month >= settlementStartMonth) {
        remainingPrincipal -= monthlyPrincipalRepayment;
        remainingPrincipal = Math.max(0, remainingPrincipal);
      }
    }
  }

  const rounded = (num) => Math.round(num * 100) / 100;

  return {
    totalInterest: rounded(totalInterest),
    totalReturns: rounded(Number(principalAmount) + Number(totalInterest)),
    effectiveRate: rounded((totalInterest / principalAmount) * 100),
    paymentType: "interest",
  };
};

// Interest with principal calculation
planSchema.methods.calculateInterestWithPrincipalReturns = function (
  principalAmount,
  monthlyRate
) {
  const repaymentConfig = this.interestWithPrincipalPayment || {};
  const principalPercentage =
    (repaymentConfig.principalRepaymentPercentage || 100) / 100;
  const paymentFrequency = repaymentConfig.paymentFrequency || "others";

  let totalInterest = 0;
  let remainingPrincipal = principalAmount;

  // Determine frequency in months
  let frequencyMonths = 1;
  switch (paymentFrequency) {
    case "quarterly":
      frequencyMonths = 3;
      break;
    case "half-yearly":
      frequencyMonths = 6;
      break;
    case "yearly":
      frequencyMonths = 12;
      break;
    default:
      frequencyMonths = 1;
  }

  const totalPaymentPeriods = Math.ceil(this.tenure / frequencyMonths);
  const principalPerPayment =
    totalPaymentPeriods > 0
      ? (principalAmount * principalPercentage) / totalPaymentPeriods
      : 0;

  for (let month = 1; month <= this.tenure; month++) {
    const interestBase =
      this.interestType === "flat" ? principalAmount : remainingPrincipal;

    totalInterest += interestBase * monthlyRate;

    if (month % frequencyMonths === 0) {
      remainingPrincipal -= principalPerPayment;
      remainingPrincipal = Math.max(0, remainingPrincipal);
    }
  }

  const round2 = (value) => Number(value.toFixed(2));

  return {
    totalInterest: round2(totalInterest),
    totalReturns: round2(Number(principalAmount) + Number(totalInterest)),
    effectiveRate: round2((totalInterest / principalAmount) * 100),
    paymentType: "interestWithPrincipal",
  };
};

// Generate payment schedule
planSchema.methods.generateSchedule = function (
  principalAmount,
  investmentDate
) {
  const schedule = [];
  let remainingPrincipal = principalAmount;
  const startDate = new Date(investmentDate);
  const monthlyRate = this.interestRate / 100;

  if (this.paymentType === "interest") {
    return this.generateInterestSchedule(
      principalAmount,
      startDate,
      monthlyRate
    );
  } else {
    return this.generateInterestWithPrincipalSchedule(
      principalAmount,
      startDate,
      monthlyRate
    );
  }
};

planSchema.methods.generateInterestSchedule = function (
  principalAmount,
  startDate,
  monthlyRate
) {
  const schedule = [];
  let remainingPrincipal = principalAmount;

  for (let month = 1; month <= this.tenure; month++) {
    const dueDate = new Date(startDate);
    dueDate.setMonth(dueDate.getMonth() + month);

    let interestAmount = 0;
    let principalAmount = 0;

    if (this.interestType === "flat") {
      interestAmount = principalAmount * monthlyRate;
    } else {
      interestAmount = remainingPrincipal * monthlyRate;
    }

    // Handle principal repayment
    if (
      this.interestPayment.principalRepaymentOption === "fixed" &&
      month === this.tenure
    ) {
      principalAmount = remainingPrincipal;
      remainingPrincipal = 0;
    } else if (this.interestPayment.principalRepaymentOption === "flexible") {
      const settlementStartMonth = Math.ceil(
        (this.tenure * this.interestPayment.withdrawalAfterPercentage) / 100
      );
      if (month >= settlementStartMonth) {
        const monthlyPrincipal =
          principalAmount / this.interestPayment.principalSettlementTerm;
        principalAmount = Math.min(monthlyPrincipal, remainingPrincipal);
        remainingPrincipal -= principalAmount;
      }
    }

    schedule.push({
      month,
      dueDate,
      interestAmount: Math.round(interestAmount * 100) / 100,
      principalAmount: Math.round(principalAmount * 100) / 100,
      totalAmount: Math.round((interestAmount + principalAmount) * 100) / 100,
      remainingPrincipal: Math.round(remainingPrincipal * 100) / 100,
      status: "pending",
      paidAmount: 0,
      paidDate: null,
    });
  }

  return schedule;
};

planSchema.methods.generateInterestWithPrincipalSchedule = function (
  principalAmount,
  startDate,
  monthlyRate
) {
  const schedule = [];
  let remainingPrincipal = principalAmount;
  const principalPercentage =
    this.interestWithPrincipalPayment.principalRepaymentPercentage / 100;

  // Calculate payment frequency
  let frequencyMonths = 1;
  switch (this.interestWithPrincipalPayment.paymentFrequency) {
    case "quarterly":
      frequencyMonths = 3;
      break;
    case "half-yearly":
      frequencyMonths = 6;
      break;
    case "yearly":
      frequencyMonths = 12;
      break;
    case "others":
      frequencyMonths = 1;
      break;
  }

  const totalPaymentPeriods = Math.ceil(this.tenure / frequencyMonths);
  const principalPerPayment =
    (principalAmount * principalPercentage) / totalPaymentPeriods;

  for (let month = 1; month <= this.tenure; month++) {
    const dueDate = new Date(startDate);
    dueDate.setMonth(dueDate.getMonth() + month);

    let interestAmount = 0;
    let principalAmount = 0;

    // Calculate interest
    if (this.interestType === "flat") {
      interestAmount = principalAmount * monthlyRate;
    } else {
      interestAmount = remainingPrincipal * monthlyRate;
    }

    // Calculate principal payment at frequency intervals
    if (month % frequencyMonths === 0 || month === this.tenure) {
      principalAmount = Math.min(principalPerPayment, remainingPrincipal);
      remainingPrincipal -= principalAmount;
    }

    schedule.push({
      month,
      dueDate,
      interestAmount: Math.round(interestAmount * 100) / 100,
      principalAmount: Math.round(principalAmount * 100) / 100,
      totalAmount: Math.round((interestAmount + principalAmount) * 100) / 100,
      remainingPrincipal: Math.round(remainingPrincipal * 100) / 100,
      status: "pending",
      paidAmount: 0,
      paidDate: null,
    });
  }

  return schedule;
};

// Index for better performance
planSchema.index({ isActive: 1 });
planSchema.index({ paymentType: 1 });
planSchema.index({ interestType: 1 });

export default mongoose.model("Plan", planSchema);
