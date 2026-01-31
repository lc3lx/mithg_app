const jwt = require("jsonwebtoken");
const User = require("../models/userModel");
const Admin = require("../models/adminModel");
const Chat = require("../models/chatModel");
const Message = require("../models/messageModel");
const Notification = require("../models/notificationModel");
const { checkMessageAndWarn } = require("../services/userWarningsService");

// تخزين المستخدمين المتصلين
const onlineUsers = new Map();

// دالة مساعدة للحصول على عدد الرسائل غير المقروءة
const getUnreadCount = async (chatId, userId) => {
  try {
    const chat = await Chat.findById(chatId).select("unreadCount");
    const unreadCount = chat.unreadCount.find(
      (count) => count.user.toString() === userId
    );
    return unreadCount ? unreadCount.count : 0;
  } catch (error) {
    return 0;
  }
};

const socketHandler = (io) => {
  const chatNamespace = io.of("/chat");
  console.log("🔌 [Chat Socket] Chat namespace '/chat' created");

  // Middleware للمصادقة
  chatNamespace.use(async (socket, next) => {
    console.log("🔐 [Chat Socket] Authentication attempt from:", socket.id);
    console.log("🔐 [Chat Socket] Handshake auth:", socket.handshake.auth);
    console.log("🔐 [Chat Socket] Handshake headers:", socket.handshake.headers);
    
    try {
      const { token } = socket.handshake.auth;
      console.log("🔐 [Chat Socket] Token received:", token ? "✅ Yes" : "❌ No");

      if (!token) {
        console.error("❌ [Chat Socket] Authentication failed: No token provided");
        return next(new Error("Authentication error: No token provided"));
      }

      console.log("🔐 [Chat Socket] Verifying token...");
      const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
      console.log("🔐 [Chat Socket] Token decoded successfully:", {
        userId: decoded.userId,
        adminId: decoded.adminId,
      });

      if (decoded.adminId) {
        console.log("🔐 [Chat Socket] Admin authentication detected");
        const admin = await Admin.findById(decoded.adminId);
        if (!admin) {
          console.error("❌ [Chat Socket] Admin not found:", decoded.adminId);
          return next(new Error("Admin not found"));
        }
        socket.role = "admin";
        socket.adminId = decoded.adminId;
        console.log("✅ [Chat Socket] Admin authenticated:", decoded.adminId);
        return next();
      }

      // التحقق من وجود المستخدم
      console.log("🔐 [Chat Socket] User authentication detected");
      const user = await User.findById(decoded.userId);
      if (!user) {
        console.error("❌ [Chat Socket] User not found:", decoded.userId);
        return next(new Error("User not found"));
      }

      socket.role = "user";
      socket.userId = decoded.userId;
      socket.user = user;
      console.log("✅ [Chat Socket] User authenticated:", {
        userId: decoded.userId,
        userName: user.name,
      });
      next();
    } catch (error) {
      console.error("❌ [Chat Socket] Authentication error:", error.message);
      console.error("❌ [Chat Socket] Error stack:", error.stack);
      next(new Error(`Authentication error: ${error.message}`));
    }
  });

  chatNamespace.on("connection", async (socket) => {
    console.log("🔌 [Chat Socket] New connection attempt:", socket.id);
    console.log("🔌 [Chat Socket] Socket role:", socket.role);
    console.log("🔌 [Chat Socket] Socket userId:", socket.userId);
    console.log("🔌 [Chat Socket] Socket adminId:", socket.adminId);
    
    // إضافة event listeners للأخطاء
    socket.on("error", (error) => {
      console.error("❌ [Chat Socket] Socket error:", error);
    });
    
    socket.on("connect_error", (error) => {
      console.error("❌ [Chat Socket] Connection error:", error);
    });
    
    if (socket.role === "admin") {
      console.log("👤 [Chat Socket] Admin connected:", socket.adminId);
      socket.join("admin_chat_monitoring");
      console.log("✅ [Chat Socket] Admin joined admin_chat_monitoring room");
    } else {
      console.log(`✅ [Chat Socket] User ${socket.userId} connected successfully`);

      // إضافة المستخدم للقائمة المتصلة
      onlineUsers.set(socket.userId, socket.id);

      // تحديث حالة المستخدم لتصبح متصل
      await User.findByIdAndUpdate(socket.userId, {
        isOnline: true,
        lastSeen: new Date(),
      });

      // إرسال قائمة المستخدمين المتصلين للجميع
      chatNamespace.emit("user_online", { userId: socket.userId });

      // الانضمام للدردشات الخاصة بالمستخدم
      const userChats = await Chat.find({
        participants: socket.userId,
        isActive: true,
      }).select("_id");

      userChats.forEach((chat) => {
        socket.join(chat._id.toString());
      });

      // إرسال إشعارات غير المقروءة
      const unreadNotifications = await Notification.countDocuments({
        user: socket.userId,
        isRead: false,
      });

      socket.emit("unread_count", { count: unreadNotifications });

      // إرسال رسائل غير المقروءة لكل دردشة
      const chatsWithUnread = await Chat.find({
        participants: socket.userId,
        isActive: true,
        "unreadCount.user": socket.userId,
      }).select("unreadCount");

      chatsWithUnread.forEach((chat) => {
        const unreadCount = chat.unreadCount.find(
          (count) => count.user.toString() === socket.userId
        );
        if (unreadCount && unreadCount.count > 0) {
          socket.emit("chat_unread_count", {
            chatId: chat._id,
            count: unreadCount.count,
          });
        }
      });
    }

    // إرسال رسالة
    socket.on("send_message", async (data) => {
      console.log("📨 [Chat Socket] send_message event received:", {
        socketId: socket.id,
        userId: socket.userId,
        chatId: data?.chatId,
        messageType: data?.messageType,
        contentLength: data?.content?.length,
      });
      
      try {
        if (socket.role === "admin") {
          console.warn("⚠️ [Chat Socket] Admin tried to send message");
          socket.emit("error", { message: "Admins cannot send messages" });
          return;
        }
        const { chatId, content, messageType = "text" } = data;

        // التحقق من أن المستخدم مشارك في الدردشة أو ولي أمر
        const chat = await Chat.findOne({
          _id: chatId,
          isActive: true,
          $or: [
            { participants: socket.userId }, // المشارك العادي
            { guardians: socket.userId }, // الولي الأمر
          ],
        });

        if (!chat) {
          socket.emit("error", { message: "Chat not found or access denied" });
          return;
        }

        // التحقق من اشتراك المستخدم وحظره
        const user = await User.findById(socket.userId);
        if (!user.isSubscribed) {
          socket.emit("error", {
            message: "You must be subscribed to send messages",
          });
          return;
        }

        if (
          user.isBlocked &&
          user.blockedUntil &&
          user.blockedUntil > new Date()
        ) {
          socket.emit("error", {
            message: `You are blocked until ${user.blockedUntil.toLocaleString()}`,
          });
          return;
        }

        // التحقق من أن الطرف الآخر لا يزال صديقاً ولم يحظر المرسل
        const otherParticipantIds = chat.participants
          .map((p) => p.toString())
          .filter((id) => id !== socket.userId);
        if (otherParticipantIds.length > 0) {
          const otherUser = await User.findById(otherParticipantIds[0])
            .select("friends blockedUsers")
            .lean();
          if (otherUser) {
            const otherBlocked = (otherUser.blockedUsers || []).map((id) =>
              id.toString()
            );
            if (otherBlocked.includes(socket.userId)) {
              socket.emit("error", {
                message: "تم حظرك من قبل هذا المستخدم",
              });
              return;
            }
            const otherFriends = (otherUser.friends || []).map((id) =>
              id.toString()
            );
            if (!otherFriends.includes(socket.userId)) {
              socket.emit("error", {
                message: "لا يمكنك إرسال رسائل بعد إلغاء الصداقة",
              });
              return;
            }
          }
        }

        // فحص الكلمات الممنوعة للرسائل النصية
        let warningResult = null;
        if (content && messageType === "text") {
          try {
            const mockReq = {
              body: { message: content, userId: socket.userId, chatId },
            };
            const mockRes = {
              status: () => ({
                json: (warningData) => {
                  warningResult = warningData;
                  return warningData;
                },
              }),
            };

            await checkMessageAndWarn(mockReq, mockRes, () => {});
          } catch (error) {
            console.error("Warning check failed:", error);
          }
        }

        // إنشاء الرسالة
        const messageData = {
          chat: chatId,
          sender: socket.userId,
          messageType,
        };

        if (content) {
          messageData.content = content;
        }

        const message = await Message.create(messageData);
        const otherParticipants = chat.participants.filter(
          (p) => p.toString() !== socket.userId
        );

        // إظهار الرسالة فوراً: populate ثم emit بدون انتظار تحديثات الدردشة/الإشعارات
        await message.populate([
          { path: "sender", select: "name profileImg" },
        ]);

        const messagePayload = {
          chatId,
          message: message.toObject ? message.toObject() : message,
        };

        // إرسال فوري للمشاركين (بما فيهم المرسل) — مثل واتساب
        chatNamespace.to(chatId).emit("new_message", messagePayload);
        chatNamespace.to("admin_chat_monitoring").emit("new_message", messagePayload);

        // تأكيد للمرسل مع الرسالة الكاملة لاستبدال المؤقت فوراً
        const responseData = {
          message: message.toObject ? message.toObject() : message,
          messageId: message._id,
        };
        if (warningResult && !warningResult.safe) {
          responseData.warning = warningResult.warning;
          responseData.bannedWord = warningResult.bannedWord;
        }
        socket.emit("message_sent", responseData);

        // تحديثات الدردشة والإشعارات بعد الإرسال (لا تُبطئ الواجهة)
        setImmediate(async () => {
          try {
            await Chat.findByIdAndUpdate(chatId, {
              lastMessage: message._id,
              lastMessageTime: new Date(),
            });

            for (const participantId of otherParticipants) {
              await Chat.findByIdAndUpdate(
                chatId,
                { $inc: { "unreadCount.$[elem].count": 1 } },
                { arrayFilters: [{ "elem.user": participantId }], upsert: true }
              );
              const participantSocketId = onlineUsers.get(participantId.toString());
              if (participantSocketId) {
                const count = await getUnreadCount(chatId, participantId);
                chatNamespace.to(participantSocketId).emit("chat_unread_count", {
                  chatId,
                  count,
                });
              }
            }

            await Promise.all(
              otherParticipants.map((participantId) =>
                Notification.createNotification({
                  user: participantId,
                  type: "new_message",
                  title: "New Message",
                  message: `${socket.user.name} sent you a message`,
                  relatedUser: socket.userId,
                  relatedChat: chatId,
                  relatedMessage: message._id,
                  data: { chatId, messageId: message._id },
                })
              )
            );

            for (const participantId of otherParticipants) {
              const participantSocketId = onlineUsers.get(participantId.toString());
              if (participantSocketId) {
                const unreadCount = await Notification.countDocuments({
                  user: participantId,
                  isRead: false,
                });
                chatNamespace.to(participantSocketId).emit("notification", {
                  type: "new_message",
                  title: "New Message",
                  message: `${socket.user.name} sent you a message`,
                  unreadCount,
                });
              }
            }
          } catch (err) {
            console.error("Chat background update error:", err);
          }
        });
      } catch (error) {
        console.error("Send message error:", error);
        socket.emit("error", { message: "Failed to send message" });
      }
    });

    // تحديد الرسائل كمقروءة
    socket.on("mark_as_read", async (data) => {
      try {
        if (socket.role === "admin") {
          socket.emit("error", { message: "Admins cannot mark messages as read" });
          return;
        }
        const { chatId } = data;

        // التحقق من أن المستخدم مشارك في الدردشة أو ولي أمر
        const chat = await Chat.findOne({
          _id: chatId,
          isActive: true,
          $or: [
            { participants: socket.userId }, // المشارك العادي
            { guardians: socket.userId }, // الولي الأمر
          ],
        });

        if (!chat) {
          socket.emit("error", { message: "Chat not found or access denied" });
          return;
        }

        // تحديد الرسائل كمقروءة
        await Message.updateMany(
          { chat: chatId, sender: { $ne: socket.userId }, isRead: false },
          { isRead: true, readAt: new Date() }
        );

        // إعادة تعيين عداد الرسائل غير المقروءة
        await Chat.findByIdAndUpdate(chatId, {
          $pull: { unreadCount: { user: socket.userId } },
        });

        // إرسال تحديث لجميع المشاركين
        chatNamespace.to(chatId).emit("messages_read", {
          chatId,
          userId: socket.userId,
        });
        chatNamespace.to("admin_chat_monitoring").emit("messages_read", {
          chatId,
          userId: socket.userId,
        });
      } catch (error) {
        console.error("Mark as read error:", error);
        socket.emit("error", { message: "Failed to mark messages as read" });
      }
    });

    // كتابة رسالة (typing indicator)
    socket.on("typing_start", (data) => {
      const { chatId } = data;
      socket.to(chatId).emit("user_typing", {
        chatId,
        userId: socket.userId,
        userName: socket.user.name,
        isTyping: true,
      });
    });

    socket.on("typing_stop", (data) => {
      const { chatId } = data;
      socket.to(chatId).emit("user_typing", {
        chatId,
        userId: socket.userId,
        userName: socket.user.name,
        isTyping: false,
      });
    });

    // إرسال إعجاب
    socket.on("send_like", async (data) => {
      try {
        const { userId } = data;

        // التحقق من وجود المستخدم المعجب به
        const targetUser = await User.findById(userId);
        if (!targetUser) {
          socket.emit("error", { message: "User not found" });
          return;
        }

        // زيادة عدد الإعجابات
        await User.findByIdAndUpdate(userId, {
          $inc: { likesReceived: 1 },
        });

        // إنشاء إشعار
        await Notification.createNotification({
          user: userId,
          type: "profile_view",
          title: "Profile Liked",
          message: `${socket.user.name} liked your profile`,
          relatedUser: socket.userId,
          data: { action: "like" },
        });

        // إرسال إشعار فوري للمستخدم المعجب به
        const targetSocketId = onlineUsers.get(userId);
        if (targetSocketId) {
          const unreadCount = await Notification.countDocuments({
            user: userId,
            isRead: false,
          });

          chatNamespace.to(targetSocketId).emit("notification", {
            type: "profile_like",
            title: "Profile Liked",
            message: `${socket.user.name} liked your profile`,
            unreadCount,
          });
        }

        // إرسال تأكيد للمرسل
        socket.emit("like_sent", { targetUserId: userId });
      } catch (error) {
        console.error("Send like error:", error);
        socket.emit("error", { message: "Failed to send like" });
      }
    });

    // عند قطع الاتصال
    socket.on("disconnect", async (reason) => {
      console.log(`🔌 [Chat Socket] User ${socket.userId} disconnected`);
      console.log(`🔌 [Chat Socket] Disconnect reason:`, reason);

      // إزالة المستخدم من القائمة المتصلة
      onlineUsers.delete(socket.userId);

      // تحديث حالة المستخدم لتصبح غير متصل
      await User.findByIdAndUpdate(socket.userId, {
        isOnline: false,
        lastSeen: new Date(),
      });

      // إرسال تحديث للجميع
      io.emit("user_offline", { userId: socket.userId });
    });

    // ping للحفاظ على الاتصال
    socket.on("ping", () => {
      socket.emit("pong");
    });
  });
};

module.exports = socketHandler;
