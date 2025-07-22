// backend/server.js - SIMPLIFIED VERSION WITH EXISTING DEPENDENCIES
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import connectDB from "./config/database.js";
import { errorHandler, requestId } from "./middleware/errorHandler.js";
import { requestLogger, logger } from "./middleware/logger.js";

// Import routes
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import investorRoutes from "./routes/investors.js";
import planRoutes from "./routes/plans.js";
import investmentRoutes from "./routes/investments.js";
import paymentRoutes from "./routes/payments.js";
import reportRoutes from "./routes/reports.js";
import settingsRoutes from "./routes/settings.js";
import dashboardRoutes from "./routes/dashboard.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5001;

// Connect to MongoDB
connectDB();

// Trust proxy for accurate IP detection
app.set("trust proxy", 1);

// CORS Configuration
const corsOptions = {
  origin: ["*", process.env.FRONTEND_URL].filter(Boolean),
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
    "x-request-id",
  ],
  optionsSuccessStatus: 200,
};

// Apply middleware
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// Request ID middleware
app.use(requestId);

// Security middleware
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false,
  })
);

app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === "production" ? 100 : 1000,
  message: {
    success: false,
    message: "Too many requests from this IP, please try again later.",
    code: "RATE_LIMIT_EXCEEDED",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/", limiter);

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Logging middleware
app.use(requestLogger);

// Static files
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Morgan for HTTP logging in development
if (process.env.NODE_ENV !== "production") {
  app.use(morgan("dev"));
}

// Health check endpoint
app.get("/api/health", async (req, res) => {
  try {
    const mongoose = await import("mongoose");
    const emailService = await import("./services/emailService.js").then(
      (m) => m.default
    );

    const health = {
      status: "OK",
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || "development",
      uptime: Math.floor(process.uptime()),
      version: "1.0.0",
      services: {
        database:
          mongoose.default.connection.readyState === 1
            ? "connected"
            : "disconnected",
        email: emailService.isReady() ? "ready" : "not configured",
      },
    };

    const isHealthy = health.services.database === "connected";
    res.status(isHealthy ? 200 : 503).json(health);
  } catch (error) {
    logger.error("Health check failed", { error: error.message });
    res.status(503).json({
      status: "ERROR",
      message: "Health check failed",
      timestamp: new Date().toISOString(),
    });
  }
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/investors", investorRoutes);
app.use("/api/plans", planRoutes);
app.use("/api/investments", investmentRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/dashboard", dashboardRoutes);

// Test endpoint
app.get("/api/test", (req, res) => {
  res.json({
    message: "Backend server is running!",
    timestamp: new Date().toISOString(),
    port: PORT,
    env: process.env.NODE_ENV || "development",
    version: "1.0.0",
  });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
    path: req.originalUrl,
  });
});

// Error handling middleware
app.use(errorHandler);

// Graceful shutdown
const gracefulShutdown = (signal) => {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });

  setTimeout(() => {
    logger.error("Forced shutdown");
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Start server
const server = app.listen(PORT, () => {
  logger.info("Server started", { port: PORT, env: process.env.NODE_ENV });

  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`🌐 CORS enabled for: ${corsOptions.origin.join(", ")}`);
  console.log(`🔗 Backend URL: http://localhost:${PORT}`);
  console.log(`📋 Test endpoint: http://localhost:${PORT}/api/test`);
  console.log(`🏥 Health check: http://localhost:${PORT}/api/health`);
});

server.on("error", (error) => {
  logger.error("Server error", { error: error.message });

  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use`);
    process.exit(1);
  }

  throw error;
});

export default app;
