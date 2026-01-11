const jwt = require("jsonwebtoken");
const User = require("../models/userModel");
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
  // Middleware للمصادقة
  io.use(async (socket, next) => {
    try {
      const { token } = socket.handshake.auth;

      if (!token) {
        return next(new Error("Authentication error"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);

      // التحقق من وجود المستخدم
      const user = await User.findById(decoded.userId);
      if (!user) {
        return next(new Error("User not found"));
      }

      socket.userId = decoded.userId;
      socket.user = user;
      next();
    } catch (error) {
      next(new Error("Authentication error"));
    }
  });

  io.on("connection", async (socket) => {
    console.log(`User ${socket.userId} connected`);

    // إضافة المستخدم للقائمة المتصلة
    onlineUsers.set(socket.userId, socket.id);

    // تحديث حالة المستخدم لتصبح متصل
    await User.findByIdAndUpdate(socket.userId, {
      isOnline: true,
      lastSeen: new Date(),
    });

    // إرسال قائمة المستخدمين المتصلين للجميع
    io.emit("user_online", { userId: socket.userId });

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

    // إرسال رسالة
    socket.on("send_message", async (data) => {
      try {
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

        // تحديث آخر رسالة في الدردشة
        await Chat.findByIdAndUpdate(chatId, {
          lastMessage: message._id,
          lastMessageTime: new Date(),
        });

        // تحديث عداد الرسائل غير المقروءة للمشاركين الآخرين
        const otherParticipants = chat.participants.filter(
          (p) => p.toString() !== socket.userId
        );

        // تحديث عداد الرسائل غير المقروءة للمشاركين الآخرين
        await Promise.all(
          otherParticipants.map(async (participantId) => {
            await Chat.findByIdAndUpdate(
              chatId,
              {
                $inc: { "unreadCount.$[elem].count": 1 },
              },
              {
                arrayFilters: [{ "elem.user": participantId }],
                upsert: true,
              }
            );

            // إرسال تحديث العداد للمستخدم المتصل
            const participantSocketId = onlineUsers.get(
              participantId.toString()
            );
            if (participantSocketId) {
              const count = await getUnreadCount(chatId, participantId);
              io.to(participantSocketId).emit("chat_unread_count", {
                chatId,
                count,
              });
            }
          })
        );

        // إضافة المرسل للرسالة
        await message.populate([
          {
            path: "sender",
            select: "name profileImg",
          },
        ]);

        // إرسال الرسالة لجميع المشاركين في الدردشة
        io.to(chatId).emit("new_message", {
          chatId,
          message: message,
        });

        // إنشاء إشعارات للمشاركين الآخرين
        const notificationPromises = otherParticipants.map((participantId) =>
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
        );

        await Promise.all(notificationPromises);

        // إرسال إشعارات فورية للمستخدمين المتصلين
        await Promise.all(
          otherParticipants.map(async (participantId) => {
            const participantSocketId = onlineUsers.get(
              participantId.toString()
            );
            if (participantSocketId) {
              const unreadCount = await Notification.countDocuments({
                user: participantId,
                isRead: false,
              });

              io.to(participantSocketId).emit("notification", {
                type: "new_message",
                title: "New Message",
                message: `${socket.user.name} sent you a message`,
                unreadCount,
              });
            }
          })
        );

        // إعداد الرد مع معلومات التحذير إذا وجدت
        const responseData = {
          messageId: message._id,
        };

        if (warningResult && !warningResult.safe) {
          responseData.warning = warningResult.warning;
          responseData.bannedWord = warningResult.bannedWord;
        }

        // إرسال تأكيد الإرسال للمرسل
        socket.emit("message_sent", responseData);
      } catch (error) {
        console.error("Send message error:", error);
        socket.emit("error", { message: "Failed to send message" });
      }
    });

    // تحديد الرسائل كمقروءة
    socket.on("mark_as_read", async (data) => {
      try {
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
        io.to(chatId).emit("messages_read", {
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

          io.to(targetSocketId).emit("notification", {
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
    socket.on("disconnect", async () => {
      console.log(`User ${socket.userId} disconnected`);

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
