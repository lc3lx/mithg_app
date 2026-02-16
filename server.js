const path = require("path");

const express = require("express");
const dotenv = require("dotenv");
const morgan = require("morgan");
const cors = require("cors");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const hpp = require("hpp");
const helmet = require("helmet");
const mongoSanitize = require("express-mongo-sanitize");
const http = require("http");
const { Server } = require("socket.io");
const supportSocket = require("./utils/supportSocket");
const supportGuestSocket = require("./utils/supportGuestSocket");
const chatSocket = require("./utils/socket");
const { processScheduledNotifications } = require("./services/notificationService");

// تحميل المتغيرات من مجلد backend (غضّ النظر عن cwd عند تشغيل pm2 أو غيره)

dotenv.config({ path: path.join(__dirname, ".env") });
const ApiError = require("./utils/apiError");
const globalError = require("./middlewares/errorMiddleware");
const dbConnection = require("./config/database");
// Routes
const mountRoutes = require("./routes");

// Connect with db
dbConnection();

// Message cleanup cron job (run daily at 2 AM)
// TODO: Uncomment after installing node-cron
// const cron = require("node-cron");
// const { archiveOldMessages } = require("./services/chatService");
// const asyncHandler = require("express-async-handler");

// cron.schedule("0 2 * * *", async () => {
//   console.log("Running scheduled message cleanup...");
//   try {
//     // Create mock request/response for the archive function
//     const mockReq = {};
//     const mockRes = {
//       status: () => ({
//         json: (data) => {
//           console.log("Message cleanup completed:", data);
//           return data;
//         },
//       }),
//     };

//     // Run the archive function
//     await archiveOldMessages(mockReq, mockRes, () => {});
//   } catch (error) {
//     console.error("Scheduled message cleanup failed:", error);
//   }
// });

// express app
const app = express();

// إنشاء HTTP server
const server = http.createServer(app);
app.set("trust proxy", 1);
// Socket.io server (support messages)
console.log("🔌 [Socket.IO] Initializing Socket.IO server...");
console.log("🔌 [Socket.IO] CORS Origin:", process.env.CLIENT_URL || "*");
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "*",
    credentials: true,
  },
});
console.log("✅ [Socket.IO] Socket.IO server created successfully");

// التقاط أخطاء المحرك والاتصالات (مثل invalid payload من البروكسي أو العميل)
io.engine.on("connection_error", (err) => {
  console.warn("⚠️ [Socket.IO] Engine connection_error:", err.message);
});
io.engine.on("connection", (rawSocket) => {
  rawSocket.on("error", (err) => {
    const msg = err && err.message ? err.message : String(err);
    if (msg.includes("invalid payload")) {
      console.warn(
        "⚠️ [Socket.IO] Invalid payload — تحقق من إعدادات WebSocket في البروكسي (nginx/Apache)."
      );
    }
  });
});

const onlineUsers = new Map();
const onlineAdmins = new Map();
app.set("io", io);
app.set("onlineUsers", onlineUsers);

console.log("🔌 [Socket.IO] Setting up support socket...");
supportSocket(io, onlineUsers, onlineAdmins);
supportGuestSocket(io);
console.log("✅ [Socket.IO] Support socket setup complete");

console.log("🔌 [Socket.IO] Setting up chat socket...");
chatSocket(io);
console.log("✅ [Socket.IO] Chat socket setup complete");

// Enable other domains to access your application
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  })
);
app.options("*", cors());

// compress all responses
app.use(compression());

// Security middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false, // Disable CSP for API
  })
);

// Data sanitization against NoSQL query injection
app.use(mongoSanitize());

// Data sanitization against XSS (additional layer)
app.use((req, res, next) => {
  if (req.body) {
    // Simple XSS protection
    const sanitizeString = (str) => {
      if (typeof str !== "string") return str;
      return str.replace(
        /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
        ""
      );
    };

    const sanitizeObject = (obj) => {
      Object.keys(obj).forEach((key) => {
        if (typeof obj[key] === "string") {
          obj[key] = sanitizeString(obj[key]);
        } else if (typeof obj[key] === "object" && obj[key] !== null) {
          sanitizeObject(obj[key]);
        }
      });
    };

    sanitizeObject(req.body);
  }
  next();
});

// Checkout webhook
// app.post(
//   "/webhook-checkout",
//   express.raw({ type: "application/json" }),
//   webhookCheckout
// );

// Serve static files (images, videos) - BEFORE other middlewares
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Log static file requests in development
if (process.env.NODE_ENV === "development") {
  app.use("/uploads/*", (req, res, next) => {
    console.log(`📁 Static file requested: ${req.originalUrl}`);
    next();
  });
}

// Middlewares
app.use(express.json({ limit: "200kb" }));

if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
  console.log(`mode: ${process.env.NODE_ENV}`);
}

// General rate limiter - Limit each IP to 100 requests per 15 minutes
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: {
    error: "Too many requests from this IP, please try again after 15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter limiter for authentication routes (disabled for development)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 150, // Increased to 50 attempts per 15 minutes for development
  message: {
    error:
      "Too many authentication attempts, please try again after 15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Limiter for chat/message sending
const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 20 messages per minute
  message: {
    error: "Too many messages sent, please slow down",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Limiter for profile views and likes
const interactionLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1000, // 10 interactions per minute
  message: {
    error: "Too many interactions, please slow down",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply the rate limiting middleware to all requests
app.use("/api", limiter);

// Middleware to protect against HTTP Parameter Pollution attacks
app.use(
  hpp({
    whitelist: [
      "price",
      "sold",
      "quantity",
      "ratingsAverage",
      "ratingsQuantity",
    ],
  })
);

// Mount Routes (OTP is ESM, loaded async; path from __dirname for reliability)
const startServer = async () => {
  try {
    const otpModule = await import("./otp/otp.routes.mjs");
    app.use("/api/v1/otp", otpModule.default);
    console.log("✅ OTP routes mounted at /api/v1/otp");
  } catch (err) {
    console.warn("⚠️ OTP routes not loaded:", err.message);
  }

  mountRoutes(app);

  app.all("*", (req, res, next) => {
    next(new ApiError(`Can't find this route: ${req.originalUrl}`, 400));
  });

  app.use(globalError);

  const PORT = process.env.PORT || 8000;
  server.listen(PORT, async () => {
    console.log(`🚀 App running on port ${PORT}`);
    console.log(`🔌 Socket.io server is running`);
    console.log(`🔌 Socket.io CORS origin:`, process.env.CLIENT_URL || "*");

    if (io && io.nsps) {
      console.log(`🔌 Socket.io namespaces:`, Object.keys(io.nsps));
    } else {
      console.log(`🔌 Socket.io namespaces: Not initialized yet`);
    }

    // جدولة الإشعارات: معالجة الإشعارات المجدولة كل دقيقة
    setInterval(() => {
      processScheduledNotifications().catch((err) => {
        console.error("[Scheduled notifications] Error:", err.message);
      });
    }, 60 * 1000);
    console.log("✅ Scheduled notifications job started (every 1 min)");
  });
};

startServer();

// Handle rejection outside express
process.on("unhandledRejection", (err) => {
  console.error(`UnhandledRejection Errors: ${err.name} | ${err.message}`);
  server.close(() => {
    console.error(`Shutting down....`);
    process.exit(1);
  });
});
