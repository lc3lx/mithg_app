const jwt = require("jsonwebtoken");
const User = require("../models/userModel");
const Admin = require("../models/adminModel");
const SupportMessage = require("../models/supportMessageModel");

const supportSocket = (io, onlineUsers, onlineAdmins) => {
  const supportNamespace = io.of("/support");

  supportNamespace.use(async (socket, next) => {
    try {
      const { token } = socket.handshake.auth || {};
      if (!token) {
        return next(new Error("Authentication error"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);

      if (decoded.adminId) {
        const admin = await Admin.findById(decoded.adminId);
        if (!admin) return next(new Error("Admin not found"));
        socket.role = "admin";
        socket.adminId = admin._id.toString();
        return next();
      }

      if (decoded.userId) {
        const user = await User.findById(decoded.userId);
        if (!user) return next(new Error("User not found"));
        socket.role = "user";
        socket.userId = user._id.toString();
        return next();
      }

      return next(new Error("Invalid token"));
    } catch (error) {
      return next(new Error("Authentication error"));
    }
  });

  supportNamespace.on("connection", (socket) => {
    if (socket.role === "user") {
      onlineUsers.set(socket.userId, socket.id);
      socket.join(`user:${socket.userId}`);
    }

    if (socket.role === "admin") {
      onlineAdmins.set(socket.adminId, socket.id);
      socket.join("admins");
    }

    socket.on("support_send", async (data) => {
      try {
        const { message, userId } = data || {};
        if (!message || !message.trim()) return;

        if (socket.role === "user") {
          const supportMessage = await SupportMessage.create({
            user: socket.userId,
            senderType: "user",
            message: message.trim(),
          });

          supportNamespace.to(`user:${socket.userId}`).emit(
            "support_message",
            supportMessage.toObject()
          );
          supportNamespace.to("admins").emit(
            "support_message",
            supportMessage.toObject()
          );
          socket.emit("support_sent", { messageId: supportMessage._id });
          return;
        }

        if (socket.role === "admin") {
          if (!userId) return;
          const supportMessage = await SupportMessage.create({
            user: userId,
            admin: socket.adminId,
            senderType: "admin",
            message: message.trim(),
          });

          supportNamespace.to(`user:${userId}`).emit(
            "support_message",
            supportMessage.toObject()
          );
          supportNamespace.to("admins").emit(
            "support_message",
            supportMessage.toObject()
          );
          socket.emit("support_sent", { messageId: supportMessage._id });
        }
      } catch (error) {
        socket.emit("support_error", { message: "Failed to send message" });
      }
    });

    socket.on("disconnect", () => {
      if (socket.role === "user") {
        onlineUsers.delete(socket.userId);
      }
      if (socket.role === "admin") {
        onlineAdmins.delete(socket.adminId);
      }
    });
  });
};

module.exports = supportSocket;

