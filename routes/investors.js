// backend/routes/investors.js - Enhanced with User Account Creation
import express from "express";
import { body, validationResult, query } from "express-validator";
import Investor from "../models/Investor.js";
import User from "../models/User.js";
import Investment from "../models/Investment.js";
import Payment from "../models/Payment.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { uploadMultiple, handleUploadError } from "../middleware/upload.js";
import emailService from "../services/emailService.js";
import { createPlan } from "../routes/plans.js";
import multer from "multer";
import Plan from "../models/Plan.js";

const router = express.Router();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "backend/uploads/"); // Create this folder if it doesn't exist
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = file.originalname.split(".").pop();
    cb(null, file.fieldname + "-" + uniqueSuffix + "." + ext);
  },
});
const upload = multer({ storage });

// @route   GET /api/investors
// @desc    Get all investors with pagination and search
// @access  Private (Admin, Finance Manager)
router.get(
  "/",
  authenticate,
  authorize("admin", "finance_manager"),
  [
    query("page")
      .optional()
      .isInt({ min: 1 })
      .withMessage("Page must be a positive integer"),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage("Limit must be between 1 and 100"),
    query("search").optional().trim(),
    query("status").optional().isIn(["active", "inactive", "blocked"]),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: "Validation failed",
        errors: errors.array(),
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const { search, status, city, kycStatus, contact, hasUserAccount } =
      req.query;

    const investmentMin = !isNaN(req.query.investmentMin)
      ? Number(req.query.investmentMin)
      : undefined;
    const investmentMax = !isNaN(req.query.investmentMax)
      ? Number(req.query.investmentMax)
      : undefined;
    const hasAccount =
      hasUserAccount === "true"
        ? true
        : hasUserAccount === "false"
        ? false
        : undefined;

    const query = {};
    const orConditions = [];

    if (city) {
      query["address.present.city"] = city;
    }

    if (kycStatus) {
      query["kyc.verificationStatus"] = kycStatus;
    }

    if (status) {
      query.status = status;
    }

    if (hasAccount === true) {
      query.userId = { $ne: null };
    } else if (hasAccount === false) {
      query.userId = null;
    }

    if (investmentMin !== undefined || investmentMax !== undefined) {
      query.totalInvestment = {};
      if (investmentMin !== undefined)
        query.totalInvestment.$gte = investmentMin;
      if (investmentMax !== undefined)
        query.totalInvestment.$lte = investmentMax;
      if (Object.keys(query.totalInvestment).length === 0)
        delete query.totalInvestment;
    }

    if (search) {
      orConditions.push(
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { investorId: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } }
      );
    }

    if (contact) {
      orConditions.push(
        { email: { $regex: contact, $options: "i" } },
        { phone: { $regex: contact, $options: "i" } }
      );
    }

    if (orConditions.length > 0) {
      query.$or = orConditions;
    }

    const [investors, total] = await Promise.all([
      Investor.find(query)
        .populate("createdBy", "name email")
        .populate("userId", "name email isActive lastLogin")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Investor.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: investors,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total,
        limit,
      },
    });
  })
);

// @route   GET /api/investors/:id
// @desc    Get single investor
// @access  Private (Admin, Finance Manager)
router.get(
  "/:id",
  authenticate,
  authorize("admin", "finance_manager"),
  asyncHandler(async (req, res) => {
    const investor = await Investor.findById(req.params.id)
      .populate("createdBy", "name email")
      .populate("userId", "name email isActive lastLogin role");

    if (!investor) {
      return res.status(404).json({ message: "Investor not found" });
    }

    // Get investments and payments summary
    const [investments, totalPayments] = await Promise.all([
      Investment.find({ investor: investor._id })
        .populate("plan", "name interestRate")
        .sort({ createdAt: -1 }),
      Payment.aggregate([
        { $match: { investor: investor._id } },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: "$amount" },
            totalInterest: { $sum: "$interestAmount" },
            totalPrincipal: { $sum: "$principalAmount" },
            count: { $sum: 1 },
          },
        },
      ]),
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
          count: 0,
        },
      },
    });
  })
);

// @route   POST /api/investors
// @desc    Create new investor with optional user account
// @access  Private (Admin, Finance Manager)
router.post(
  "/",
  upload.fields([
    { name: "kyc.panCardFile", maxCount: 1 },
    { name: "kyc.aadharCardFile", maxCount: 1 },
    { name: "kyc.bankDetails.bankProofFile", maxCount: 1 },
  ]),
  authenticate,
  authorize("admin", "finance_manager"),
  [
    body("name").trim().notEmpty().withMessage("Name is required"),
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Please enter a valid email"),
    body("phone")
      .matches(/^[6-9]\d{9}$/)
      .withMessage("Please enter a valid 10-digit phone number"),
    body("altPhone")
      .optional()
      .matches(/^[6-9]\d{9}$/)
      .withMessage("Please enter a valid 10-digit phone number"),
    body("status")
      .optional()
      .isIn(["active", "inactive", "blocked"])
      .withMessage("Invalid status"),

    // Address validation
    body("address.present.street")
      .notEmpty()
      .withMessage("Street address is required"),
    body("address.present.city").notEmpty().withMessage("City is required"),
    body("address.present.state").notEmpty().withMessage("State is required"),
    body("address.present.pincode")
      .matches(/^\d{6}$/)
      .withMessage("Please enter a valid 6-digit pincode"),
    body("address.present.country")
      .notEmpty()
      .withMessage("Country is required"),
    body("address.permanent.street").optional().trim(),
    body("address.permanent.city").optional().trim(),
    body("address.permanent.state").optional().trim(),
    body("address.permanent.pincode")
      .optional()
      .matches(/^\d{6}$/)
      .withMessage("Please enter a valid 6-digit pincode"),
    body("address.permanent.country").optional().trim(),
    body("address.sameAsPresent").optional().isBoolean(),

    // KYC validation
    body("kyc.panNumber")
      .matches(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/)
      .withMessage("Please enter a valid PAN number"),
    body("kyc.aadharNumber")
      .matches(/^\d{12}$/)
      .withMessage("Please enter a valid 12-digit Aadhar number"),
    body("kyc.bankDetails.bankName")
      .notEmpty()
      .withMessage("Bank name is required"),
    body("kyc.bankDetails.accountHolderName")
      .notEmpty()
      .withMessage("Bank account holder name is required"),
    body("kyc.bankDetails.accountNumber")
      .notEmpty()
      .withMessage("Account number is required"),
    body("kyc.bankDetails.ifscCode")
      .matches(/^[A-Z]{4}0[A-Z0-9]{6}$/)
      .withMessage("Please enter a valid IFSC code"),
    body("kyc.bankDetails.branchName")
      .notEmpty()
      .withMessage("Branch name is required"),

    // User account creation validation
    body("createUserAccount").optional().isBoolean(),
    body("userAccountDetails.password")
      .optional()
      .isLength({ min: 8 })
      .withMessage("Password must be at least 8 characters"),
    body("userAccountDetails.confirmPassword")
      .optional()
      .custom((value, { req }) => {
        if (
          req.body.createUserAccount &&
          value !== req.body.userAccountDetails?.password
        ) {
          throw new Error("Passwords do not match");
        }
        return true;
      }),
    body("userAccountDetails.sendCredentials").optional().isBoolean(),
    body("userAccountDetails.temporaryPassword").optional().isBoolean(),

    // Nominee validation
    body("nominee.name").notEmpty().withMessage("Nominee name is required"),
    body("nominee.relation").notEmpty().withMessage("Relation is required"),
    body("nominee.mobile")
      .matches(/^[6-9]\d{9}$/)
      .withMessage("Please enter a valid 10-digit phone number"),
    body("nominee.email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Please enter a valid email"),

    // Referral validation
    body("referral.name").optional().trim(),
    body("referral.email")
      .optional()
      .isEmail()
      .normalizeEmail()
      .withMessage("Please enter a valid email"),
    body("referral.mobile")
      .optional()
      .matches(/^[6-9]\d{9}$/)
      .withMessage("Please enter a valid 10-digit phone number"),
    body("referral.altMobile")
      .optional()
      .matches(/^[6-9]\d{9}$/)
      .withMessage("Please enter a valid 10-digit phone number"),
    body("referral.type")
      .optional()
      .isIn(["employee", "agent", "consultant", "friend", "relative", "other"])
      .withMessage("Invalid referral type"),
    body("referral.otherTypeDetail").optional().trim(),
    body("referral.referralFeeExpectation").optional().isBoolean(),
    body("referral.referralFeePercentMonthly")
      .optional()
      .isFloat({ min: 0, max: 100 })
      .withMessage("Referral fee must be between 0 and 100"),

    // Investment validation
    body("investment.amount")
      .optional()
      .isFloat({ min: 0 })
      .withMessage("Investment amount must be positive"),
    body("investment.investmentDate")
      .optional()
      .isISO8601()
      .withMessage("Invalid date format"),
    body("investment.tenureMonths")
      .optional()
      .isInt({ min: 0 })
      .withMessage("Tenure must be a positive number"),
    body("investment.interestRateMonthly")
      .optional()
      .isFloat({ min: 0 })
      .withMessage("Interest rate must be positive"),
    body("investment.referralPercentMonthly")
      .optional()
      .isFloat({ min: 0, max: 100 })
      .withMessage("Referral percent must be between 0 and 100"),
    body("investment.planMode")
      .optional()
      .isIn(["existing", "new"])
      .withMessage("Invalid plan mode"),
    body("investment.existingPlanId")
      .optional()
      .isEmpty()
      .withMessage("Invalid plan ID"),

    // Custom plan validation
    body("investment.customPlan.planType")
      .optional()
      .isIn(["interestOnly", "interestPlusPrincipal"])
      .withMessage("Invalid plan type"),
    body("investment.customPlan.interestRate")
      .optional()
      .isFloat({ min: 0 })
      .withMessage("Interest rate must be positive"),
    body("investment.customPlan.interestType")
      .optional()
      .isIn(["flat", "reducing"])
      .withMessage("Invalid interest type"),
    body("investment.customPlan.paymentFrequency")
      .optional()
      .isIn(["monthly", "quarterly", "others"])
      .withMessage("Invalid payment frequency"),
    body("investment.customPlan.interestStartDate")
      .optional()
      .isISO8601()
      .withMessage("Invalid date format"),
    body("investment.customPlan.principalSettlement")
      .optional()
      .isIn(["fixedTenure", "flexibleWithdrawal"])
      .withMessage("Invalid principal settlement type"),
    body("investment.customPlan.withdrawalAfterPercentTenure")
      .optional()
      .isFloat({ min: 0, max: 100 })
      .withMessage("Must be between 0 and 100"),
    body("investment.customPlan.principalSettlementTermMonths")
      .optional()
      .isInt({ min: 0 })
      .withMessage("Must be a positive number"),
    body("investment.customPlan.principalRepaymentPercent")
      .optional()
      .isFloat({ min: 0, max: 100 })
      .withMessage("Must be between 0 and 100"),
    body("investment.customPlan.interestPayoutDate")
      .optional()
      .isISO8601()
      .withMessage("Invalid date format"),
    body("investment.customPlan.principalPayoutDate")
      .optional()
      .isISO8601()
      .withMessage("Invalid date format"),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: "Validation failed",
        errors: errors.array(),
      });
    }

    const {
      name,
      email,
      phone,
      altPhone,
      address,
      kyc,
      status = "active",
      createUserAccount,
      userAccountDetails,
      nominee,
      referral,
      investment,
    } = req.body;

    // Check if investor already exists
    const existingInvestor = await Investor.findOne({
      $or: [
        { email },
        { "kyc.panNumber": kyc.panNumber },
        { "kyc.aadharNumber": kyc.aadharNumber },
      ],
    });

    if (existingInvestor) {
      return res.status(400).json({
        message:
          "Investor already exists with this email, PAN, or Aadhar number",
      });
    }

    // Handle file uploads
    const files = req.files;
    // const panCardFile = files["kyc.panCardFile"]?.[0];
    // const aadharCardFile = files["kyc.aadharCardFile"]?.[0];
    // const bankProofFile = files["kyc.bankDetails.bankProofFile"]?.[0];
    const panCardFile = null;
    const aadharCardFile = null;
    const bankProofFile = null;

    // Check if user with email already exists (if creating user account)
    let userId = null;
    let userCredentials = null;

    if (createUserAccount) {
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({
          message: "A user account with this email already exists",
        });
      }

      // Create user account
      try {
        const newUser = await User.create({
          name,
          email,
          password: userAccountDetails.password,
          role: "investor",
          phone,
          status: "active",
        });

        userId = newUser._id;

        // Store credentials for email (if needed)
        if (userAccountDetails.sendCredentials) {
          userCredentials = {
            email,
            password: userAccountDetails.password,
            isTemporary: userAccountDetails.temporaryPassword || false,
          };
        }

        console.log(`User account created for investor: ${email}`);
      } catch (userError) {
        console.error("Failed to create user account:", userError);
        return res.status(500).json({
          message: "Failed to create user account",
          error: userError.message,
        });
      }
    }

    // Create investor
    try {
      const investorData = {
        name,
        email,
        phone,
        altPhone,
        address,
        kyc: {
          ...kyc,
          panCardFile: panCardFile?.path,
          aadharCardFile: aadharCardFile?.path,
          bankDetails: {
            ...kyc.bankDetails,
            bankProofFile: bankProofFile?.path,
          },
        },
        status,
        nominee,
        referral,
        userId,
        createdBy: req.user._id,
      };

      let newPlan = null;
      let planId = null;
      // Add investment if provided
      if (investment) {
        investorData.investment = investment;

        // Handle custom plan creation if needed
        if (investment.planMode === "new" && investment.customPlan) {
          let features = investment.customPlan.features;
          if (typeof features === "string") {
            features = features
              .split(",")
              .map((f) => f.trim())
              .filter(Boolean);
          }
          const paymentType = investment.customPlan.paymentType;

          // Map tenure correctly
          const tenure = investment.customPlan.tenure;

          const planDetails = {
            name: investment.customPlan.name || `Custom Plan for ${name}`,
            description:
              investment.customPlan.description ||
              "Custom investment plan created with investor",
            interestRate: investment.customPlan.interestRate,
            interestType: investment.customPlan.interestType,
            tenure,
            minInvestment: investment.amount,
            maxInvestment: investment.amount,
            amountInvested: investment.amount,
            dateOfInvestment: investment.investmentDate,
            isActive: true,
            paymentType,
            features,
            riskLevel: investment.customPlan.riskLevel,
            ...(paymentType === "interest"
              ? {
                  interestPayment: {
                    ...investment.customPlan.interestPayment,
                    amountInvested: investment.amount,
                    dateOfInvestment: investment.investmentDate,
                  },
                }
              : {
                  interestWithPrincipalPayment: {
                    ...investment.customPlan.interestWithPrincipalPayment,
                    amountInvested: investment.amount,
                    dateOfInvestment: investment.investmentDate,
                  },
                }),
            createdBy: req.user._id,
          };

          newPlan = await Plan.create(planDetails);
          planId = newPlan._id;
          investorData.investment.existingPlanId = newPlan._id;
        } else if (investment.planMode === "existing") {
          planId = investment.existingPlanId;
        }
      }

      const investor = await Investor.create(investorData);
      if (investment) {
        let plan;
        if (investment.planMode === "new" && newPlan) {
          plan = newPlan;
        } else if (investment.planMode === "existing" && planId) {
          plan = await Plan.findById(planId);
        }

        // Calculate maturity date
        const investmentDate = new Date(investment.investmentDate);
        const tenure = plan?.tenure || investment.tenureMonths || 0;
        const maturityDate = new Date(investmentDate);
        maturityDate.setMonth(maturityDate.getMonth() + Number(tenure));
        const investmentData = {
          investor: investor._id,
          plan: planId,
          principalAmount: investment.amount,
          remainingAmount: investment.amount, // or your logic
          totalInterestExpected: investment.totalInterestExpected || 0, // or calculate
          totalExpectedReturns: investment.totalExpectedReturns || 0, // or calculate
          paymentType: plan?.paymentType || investment.paymentType,
          tenure: plan?.tenure || investment.tenureMonths,
          interestType: plan?.interestType || investment.interestType,
          interestRate: plan?.interestRate || investment.interestRateMonthly,
          maturityDate,
          investmentDate,
          createdBy: req.user._id,
          ...investment,
        };

        await Investment.create(investmentData);
      }

      await investor.populate("createdBy", "name email");

      // Send welcome email if user account was created and email should be sent
      if (
        createUserAccount &&
        userCredentials &&
        userAccountDetails.sendCredentials
      ) {
        try {
          const emailResult = await emailService.sendWelcomeEmail(
            investor,
            userCredentials
          );
          console.log("Email result:", emailResult);
        } catch (emailError) {
          console.error("Failed to send welcome email:", emailError);
          // Don't fail the entire operation due to email failure
        }
      }

      res.status(201).json({
        success: true,
        message: createUserAccount
          ? "Investor and user account created successfully"
          : "Investor created successfully",
        data: {
          investor,
          userAccountCreated: !!createUserAccount,
          emailSent: !!(
            createUserAccount && userAccountDetails.sendCredentials
          ),
        },
      });
    } catch (investorError) {
      // If investor creation fails but user was created, clean up the user
      if (userId) {
        try {
          await User.findByIdAndDelete(userId);
          console.log(
            "Cleaned up user account after investor creation failure"
          );
        } catch (cleanupError) {
          console.error("Failed to cleanup user account:", cleanupError);
        }
      }

      console.error("Investor creation error:", investorError);
      return res.status(500).json({
        message: "Failed to create investor",
        error: investorError.message,
      });
    }
  })
);

// @route   PUT /api/investors/:id
// @desc    Update investor
// @access  Private (Admin, Finance Manager)
router.put(
  "/:id",
  authenticate,
  authorize("admin", "finance_manager"),
  [
    body("name")
      .optional()
      .trim()
      .notEmpty()
      .withMessage("Name cannot be empty"),
    body("email")
      .optional()
      .isEmail()
      .normalizeEmail()
      .withMessage("Please enter a valid email"),
    body("phone")
      .optional()
      .matches(/^[6-9]\d{9}$/)
      .withMessage("Please enter a valid 10-digit phone number"),
    body("status").optional().isIn(["active", "inactive", "blocked"]),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: "Validation failed",
        errors: errors.array(),
      });
    }

    const investor = await Investor.findById(req.params.id).populate("userId");
    if (!investor) {
      return res.status(404).json({ message: "Investor not found" });
    }

    // Check for conflicts if email, PAN, or Aadhar is being updated
    const { email, kyc } = req.body;
    if (email || kyc) {
      const conflicts = {};
      if (email && email !== investor.email) conflicts.email = email;
      if (kyc?.panNumber && kyc.panNumber !== investor.kyc.panNumber) {
        conflicts["kyc.panNumber"] = kyc.panNumber;
      }
      if (kyc?.aadharNumber && kyc.aadharNumber !== investor.kyc.aadharNumber) {
        conflicts["kyc.aadharNumber"] = kyc.aadharNumber;
      }

      if (Object.keys(conflicts).length > 0) {
        const existingInvestor = await Investor.findOne({
          _id: { $ne: investor._id },
          $or: Object.entries(conflicts).map(([key, value]) => ({
            [key]: value,
          })),
        });

        if (existingInvestor) {
          return res.status(400).json({
            message:
              "Another investor already exists with this email, PAN, or Aadhar number",
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
        console.error("Failed to update user email:", userUpdateError);
        return res.status(500).json({
          message: "Failed to update linked user account",
        });
      }
    }

    // Update investor status and linked user status
    if (req.body.status && investor.userId) {
      const userIsActive = req.body.status === "active";
      try {
        await User.findByIdAndUpdate(investor.userId, {
          isActive: userIsActive,
        });
        console.log(
          `Updated user status for investor ${investor.investorId}: ${userIsActive}`
        );
      } catch (userStatusError) {
        console.error("Failed to update user status:", userStatusError);
      }
    }

    // Update investor
    Object.assign(investor, req.body);
    await investor.save();
    await investor.populate("createdBy", "name email");

    res.json({
      success: true,
      message: "Investor updated successfully",
      data: investor,
    });
  })
);

// @route   DELETE /api/investors/:id
// @desc    Delete investor
// @access  Private (Admin only)
router.delete(
  "/:id",
  authenticate,
  authorize("admin"),
  asyncHandler(async (req, res) => {
    const investor = await Investor.findById(req.params.id).populate("userId");
    if (!investor) {
      return res.status(404).json({ message: "Investor not found" });
    }

    // Check if investor has active investments
    const activeInvestments = await Investment.countDocuments({
      investor: investor._id,
      status: "active",
    });

    if (activeInvestments > 0) {
      return res.status(400).json({
        message: "Cannot delete investor with active investments",
      });
    }

    // Delete linked user account if exists
    if (investor.userId) {
      try {
        await User.findByIdAndDelete(investor.userId);
        console.log(`Deleted user account for investor ${investor.investorId}`);
      } catch (userDeleteError) {
        console.error("Failed to delete user account:", userDeleteError);
        // Continue with investor deletion even if user deletion fails
      }
    }

    await investor.deleteOne();

    res.json({
      success: true,
      message: "Investor and associated user account deleted successfully",
    });
  })
);

// NEW: @route   POST /api/investors/:id/create-user-account
// @desc    Create user account for existing investor
// @access  Private (Admin, Finance Manager)
router.post(
  "/:id/create-user-account",
  authenticate,
  authorize("admin", "finance_manager"),
  [
    body("password")
      .isLength({ min: 8 })
      .withMessage("Password must be at least 8 characters"),
    body("sendCredentials").optional().isBoolean(),
    body("temporaryPassword").optional().isBoolean(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: "Validation failed",
        errors: errors.array(),
      });
    }

    const investor = await Investor.findById(req.params.id);
    if (!investor) {
      return res.status(404).json({ message: "Investor not found" });
    }

    if (investor.userId) {
      return res.status(400).json({
        message: "User account already exists for this investor",
      });
    }

    const {
      password,
      sendCredentials = false,
      temporaryPassword = false,
    } = req.body;

    // Check if user with email already exists
    const existingUser = await User.findOne({ email: investor.email });
    if (existingUser) {
      return res.status(400).json({
        message: "A user account with this email already exists",
      });
    }

    try {
      // Create user account
      const newUser = await User.create({
        name: investor.name,
        email: investor.email,
        password,
        role: "investor",
        phone: investor.phone,
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
            isTemporary: temporaryPassword,
          });
          console.log("Email result:", emailResult);
        } catch (emailError) {
          console.error("Failed to send credentials email:", emailError);
        }
      }

      res.json({
        success: true,
        message: "User account created successfully",
        data: {
          userId: newUser._id,
          emailSent: sendCredentials,
        },
      });
    } catch (error) {
      console.error("Failed to create user account:", error);
      res.status(500).json({
        message: "Failed to create user account",
        error: error.message,
      });
    }
  })
);

// NEW: @route   POST /api/investors/:id/reset-password
// @desc    Reset password for investor's user account
// @access  Private (Admin, Finance Manager)
router.post(
  "/:id/reset-password",
  authenticate,
  authorize("admin", "finance_manager"),
  [
    body("newPassword")
      .isLength({ min: 8 })
      .withMessage("Password must be at least 8 characters"),
    body("sendCredentials").optional().isBoolean(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: "Validation failed",
        errors: errors.array(),
      });
    }

    const investor = await Investor.findById(req.params.id).populate("userId");
    if (!investor) {
      return res.status(404).json({ message: "Investor not found" });
    }

    if (!investor.userId) {
      return res.status(400).json({
        message: "No user account exists for this investor",
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
          const emailResult = await emailService.sendPasswordResetEmail(
            investor,
            newPassword
          );
          console.log("Password reset email result:", emailResult);
        } catch (emailError) {
          console.error("Failed to send password reset email:", emailError);
        }
      }

      res.json({
        success: true,
        message: "Password reset successfully",
        data: {
          emailSent: sendCredentials,
        },
      });
    } catch (error) {
      console.error("Failed to reset password:", error);
      res.status(500).json({
        message: "Failed to reset password",
        error: error.message,
      });
    }
  })
);

// @route   POST /api/investors/:id/documents
// @desc    Upload investor documents
// @access  Private (Admin, Finance Manager)
router.post(
  "/:id/documents",
  authenticate,
  authorize("admin", "finance_manager"),
  uploadMultiple("documents"),
  handleUploadError,
  asyncHandler(async (req, res) => {
    const investor = await Investor.findById(req.params.id);
    if (!investor) {
      return res.status(404).json({ message: "Investor not found" });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "No files uploaded" });
    }

    // Add uploaded files to investor's agreements
    const newDocuments = req.files.map((file) => ({
      fileName: file.originalname,
      filePath: file.path,
      uploadDate: new Date(),
    }));

    investor.agreements.push(...newDocuments);
    await investor.save();

    res.json({
      success: true,
      message: "Documents uploaded successfully",
      data: {
        uploaded: newDocuments.length,
        documents: investor.agreements,
      },
    });
  })
);

// NEW: @route   POST /api/investors/test-email
// @desc    Test email configuration
// @access  Private (Admin only)
router.post(
  "/test-email",
  authenticate,
  authorize("admin"),
  [body("email").isEmail().withMessage("Valid email is required")],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: "Validation failed",
        errors: errors.array(),
      });
    }

    const { email } = req.body;

    try {
      const result = await emailService.sendTestEmail(email);

      if (result.success) {
        res.json({
          success: true,
          message: "Test email sent successfully",
          data: {
            messageId: result.messageId,
            sentTo: email,
          },
        });
      } else {
        res.status(500).json({
          success: false,
          message: result.message,
          error: result.error,
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Failed to send test email",
        error: error.message,
      });
    }
  })
);

// @route   GET /api/investors/stats/overview
// @desc    Get investors overview stats
// @access  Private (Admin, Finance Manager)
router.get(
  "/stats/overview",
  authenticate,
  authorize("admin", "finance_manager"),
  asyncHandler(async (req, res) => {
    const [
      totalInvestors,
      activeInvestors,
      newThisMonth,
      totalInvestment,
      averageInvestment,
      withUserAccounts,
      activeUserAccounts,
    ] = await Promise.all([
      Investor.countDocuments(),
      Investor.countDocuments({ status: "active" }),
      Investor.countDocuments({
        createdAt: {
          $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        },
      }),
      Investor.aggregate([
        { $group: { _id: null, total: { $sum: "$totalInvestment" } } },
      ]),
      Investor.aggregate([
        { $group: { _id: null, average: { $avg: "$totalInvestment" } } },
      ]),
      Investor.countDocuments({ userId: { $ne: null } }),
      Investor.aggregate([
        {
          $lookup: {
            from: "users",
            localField: "userId",
            foreignField: "_id",
            as: "user",
          },
        },
        {
          $match: {
            "user.isActive": true,
          },
        },
        {
          $count: "activeUsers",
        },
      ]),
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
        userAccountPercentage:
          totalInvestors > 0
            ? Math.round((withUserAccounts / totalInvestors) * 100)
            : 0,
      },
    });
  })
);

export default router;
