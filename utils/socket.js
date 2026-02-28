const jwt = require("jsonwebtoken");
const User = require("../models/userModel");
const Admin = require("../models/adminModel");
const Chat = require("../models/chatModel");
const Message = require("../models/messageModel");
const Notification = require("../models/notificationModel");
const BannedWords = require("../models/bannedWordsModel");
const { checkMessageAndWarn } = require("../services/userWarningsService");
const { hasActiveSubscriptionAndVerification } = require("../middlewares/subscriptionMiddleware");

const isFullOrPermanentBlock = (user) => {
  if (!user || !user.blockedUntil) return false;
  const hasFullIdentifiers =
    !!user.blockedIdentifiers?.phone ||
    (user.blockedIdentifiers?.ips || []).length > 0 ||
    (user.blockedIdentifiers?.deviceIds || []).length > 0;
  const yearsAhead = user.blockedUntil.getFullYear() - new Date().getFullYear();
  const isPermanentStyle = yearsAhead >= 10;
  return hasFullIdentifiers || isPermanentStyle;
};

// تخزين المستخدمين المتصلين
const onlineUsers = new Map();

// تجميع إشعارات الرسائل: إشعار واحد لكل مجموعة رسائل متتالية حتى يفتح المستقبل المحادثة
// مفتاح: `${userId}:${chatId}` ، القيمة: timestamp
const lastOpenedChatAt = new Map();
const lastMessageNotificationAt = new Map();

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
    
    // معالجة أخطاء السوكت (مثل invalid payload: غالباً بروكسي أو عميل يرسل بيانات غير صالحة)
    socket.on("error", (error) => {
      const msg = error && error.message ? error.message : String(error);
      if (msg.includes("invalid payload")) {
        console.warn(
          "⚠️ [Chat Socket] Invalid payload from client — قد يكون بسبب البروكسي (nginx/Apache) أو تطبيق العميل. فصل السوكت للسماح بإعادة الاتصال."
        );
      } else {
        console.error("❌ [Chat Socket] Socket error:", error);
      }
      try {
        socket.disconnect(true);
      } catch (e) {
        // تجاهل إن كان السوكت مغلقاً أصلاً
      }
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
        const { chatId, content, messageType = "text", clientTempId } = data;

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

        // التحقق من اشتراك فعال + حساب موثق (باك + فرونت)
        const check = await hasActiveSubscriptionAndVerification(socket.userId);
        if (!check.ok) {
          socket.emit("error", {
            message:
              check.reason === "verification"
                ? "هذه الميزة تتطلب توثيق الهوية. يرجى توثيق حسابك أولاً"
                : "إرسال الرسائل متاح فقط للمستخدمين المشتركين. يرجى ترقية اشتراكك لإمكانية المراسلة",
          });
          return;
        }
        const user = await User.findById(socket.userId);
        if (!user) return;

        if (
          user.isBlocked &&
          user.blockedUntil &&
          user.blockedUntil > new Date()
        ) {
          const blockedMessage = isFullOrPermanentBlock(user)
            ? "تم حظر حسابك بشكل كامل"
            : `You are blocked until ${user.blockedUntil.toLocaleString()}`;
          socket.emit("error", {
            message: blockedMessage,
          });
          return;
        }

        // التحقق من أن الطرف الآخر لا يزال صديقاً ولم يحظر المرسل
        // chat.participants may be populated (user docs); extract raw id for findById
        const myIdStr = (socket.userId && (socket.userId.toString ? socket.userId.toString() : socket.userId)) || "";
        const otherParticipantIds = chat.participants
          .map((p) => {
            if (!p) return null;
            const { _id: pId, id: pIdAlt } = p;
            let idVal = p;
            if (pId !== undefined) idVal = pId;
            else if (pIdAlt !== undefined) idVal = pIdAlt;
            if (!idVal) return null;
            return typeof idVal.toString === "function" ? idVal.toString() : String(idVal);
          })
          .filter(Boolean)
          .filter((id) => id !== myIdStr);
        if (otherParticipantIds.length > 0) {
          const otherUser = await User.findById(otherParticipantIds[0])
            .select("friends blockedUsers")
            .lean();
          if (otherUser) {
            const otherBlocked = (otherUser.blockedUsers || []).map((id) =>
              id.toString()
            );
            if (otherBlocked.includes(myIdStr)) {
              socket.emit("error", {
                message: "تم حظرك من قبل هذا المستخدم",
              });
              return;
            }
            const otherFriends = (otherUser.friends || []).map((id) =>
              id.toString()
            );
            if (!otherFriends.includes(myIdStr)) {
              socket.emit("error", {
                message: "لا يمكنك إرسال رسائل بعد إلغاء الصداقة",
              });
              return;
            }
          }
        }

        // فحص الكلمات الممنوعة للرسائل النصية (للتحذير)
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

        // استبدال الكلمات المحظورة بـ **** حتى لا تظهر في المحادثة
        let contentToStore = content;
        if (content && typeof content === "string") {
          contentToStore = await BannedWords.maskMessage(content);
        }

        // إنشاء الرسالة
        const messageData = {
          chat: chatId,
          sender: socket.userId,
          messageType,
        };

        if (contentToStore) {
          messageData.content = contentToStore;
        }

        const message = await Message.create(messageData);
        // otherParticipants = IDs of everyone except sender (already normalized above)
        const otherParticipants = otherParticipantIds;

        // إظهار الرسالة فوراً: populate ثم emit بدون انتظار تحديثات الدردشة/الإشعارات
        await message.populate([
          { path: "sender", select: "name profileImg" },
        ]);

        const messagePayload = {
          chatId,
          message: message.toObject ? message.toObject() : message,
          ...(clientTempId ? { clientTempId } : {}),
        };

        // إرسال فوري للمشاركين (بما فيهم المرسل) — مثل واتساب
        chatNamespace.to(chatId).emit("new_message", messagePayload);
        chatNamespace.to("admin_chat_monitoring").emit("new_message", messagePayload);

        // تأكيد للمرسل مع الرسالة الكاملة لاستبدال المؤقت فوراً
        const responseData = {
          message: message.toObject ? message.toObject() : message,
          messageId: message._id,
          ...(clientTempId ? { clientTempId } : {}),
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

            const roomChatId = chatId.toString();
            const socketsInChatRoom = chatNamespace.adapter.rooms?.get(roomChatId);

            const isParticipantViewingChat = (participantId) => {
              const participantSocketId = onlineUsers.get(
                participantId.toString()
              );
              return !!(
                participantSocketId &&
                socketsInChatRoom &&
                socketsInChatRoom.has(participantSocketId)
              );
            };

            await Promise.all(
              otherParticipants.map(async (participantId) => {
                if (isParticipantViewingChat(participantId)) return;
                const participantSocketId = onlineUsers.get(
                  participantId.toString()
                );
                if (!participantSocketId) return;
                const count = await getUnreadCount(chatId, participantId);
                chatNamespace.to(participantSocketId).emit("chat_unread_count", {
                  chatId,
                  count,
                });
              })
            );

            // إشعار واحد لكل مجموعة رسائل: لا نرسل إشعاراً جديداً إذا أرسلنا بالفعل ولم يفتح المستقبل المحادثة
            const shouldSendNotification = (participantId) => {
              if (isParticipantViewingChat(participantId)) return false;
              const key = `${participantId}:${chatId}`;
              const lastNotif = lastMessageNotificationAt.get(key);
              const lastOpened = lastOpenedChatAt.get(key);
              if (lastNotif != null && (lastOpened == null || lastOpened < lastNotif)) return false;
              return true;
            };

            // إشعار واحد فقط: إنشاء إشعار في DB (يرسل push واحد) دون إرسال حدث notification بالسوكت لتفادي تكرار الإشعار
            await Promise.all(
              otherParticipants.map((participantId) => {
                if (!shouldSendNotification(participantId)) return null;
                return Notification.createNotification({
                  user: participantId,
                  type: "new_message",
                  title: "New Message",
                  message: `${socket.user.name} sent you a message`,
                  relatedUser: socket.userId,
                  relatedChat: chatId,
                  relatedMessage: message._id,
                  data: { chatId, messageId: message._id },
                });
              })
            );

            await Promise.all(
              otherParticipants.map(async (participantId) => {
                if (!shouldSendNotification(participantId)) return;
                const key = `${participantId}:${chatId}`;
                lastMessageNotificationAt.set(key, Date.now());
                // لا نرسل حدث notification بالسوكت لرسائل المحادثة — الإشعار الوحيد هو الـ push من createNotification
              })
            );
          } catch (err) {
            console.error("Chat background update error:", err);
          }
        });
      } catch (error) {
        console.error("Send message error:", error);
        socket.emit("error", { message: "Failed to send message" });
      }
    });

    // جلب قائمة المحادثات عبر السوكت (بديل REST)
    socket.on("get_chats", async () => {
      try {
        if (socket.role === "admin") return;
        const userId = socket.userId;
        const check = await hasActiveSubscriptionAndVerification(userId);
        if (!check.ok) {
          socket.emit("error", {
            message:
              check.reason === "verification"
                ? "هذه الميزة تتطلب توثيق الهوية. يرجى توثيق حسابك أولاً"
                : "هذه الميزة متاحة فقط للمستخدمين المشتركين. يرجى ترقية اشتراكك للوصول إلى هذه الخدمة",
          });
          return;
        }

        const chats = await Chat.find({
          participants: userId,
          isActive: true,
        })
          .populate({
            path: "participants",
            select: "name profileImg isOnline lastSeen",
          })
          .populate({
            path: "lastMessage",
            select: "content sender messageType createdAt isRead",
            populate: { path: "sender", select: "name" },
          })
          .sort({ lastMessageTime: -1 })
          .lean();

        let chatsWithUnread = await Promise.all(
          chats.map(async (chat) => {
            const unreadEntry = (chat.unreadCount || []).find(
              (c) => c.user && c.user.toString() === userId.toString()
            );
            return {
              ...chat,
              unreadCount: unreadEntry ? unreadEntry.count : 0,
            };
          })
        );

        const otherParticipantIds = chatsWithUnread
          .map((c) => {
            const other = (c.participants || []).find(
              (p) => (p._id || p).toString() !== userId.toString()
            );
            return other ? (other._id || other).toString() : null;
          })
          .filter(Boolean);

        if (otherParticipantIds.length > 0) {
          const usersWhoBlockedMe = await User.find(
            { _id: { $in: otherParticipantIds }, blockedUsers: userId },
            { _id: 1 }
          )
            .lean()
            .then((list) => list.map((u) => u._id.toString()));

          chatsWithUnread = chatsWithUnread.filter((c) => {
            const other = (c.participants || []).find(
              (p) => (p._id || p).toString() !== userId.toString()
            );
            if (!other) return true;
            const otherId = (other._id || other).toString();
            return !usersWhoBlockedMe.includes(otherId);
          });
        }

        const currentUser = await User.findById(userId).select("friends").lean();
        const friendIds = (currentUser?.friends || []).map((id) => id.toString());

        chatsWithUnread = chatsWithUnread.filter((c) => {
          const participants = c.participants || [];
          if (participants.length !== 2) return true;
          const other = participants.find(
            (p) => (p._id || p).toString() !== userId.toString()
          );
          if (!other) return true;
          const otherId = (other._id || other).toString();
          return friendIds.includes(otherId);
        });

        socket.emit("chats_list", { data: chatsWithUnread });
      } catch (err) {
        console.error("get_chats error:", err);
        socket.emit("error", { message: "Failed to load chats" });
      }
    });

    // جلب تفاصيل محادثة + رسائل عبر السوكت (بديل REST، بدون تحديد كمقروءة)
    socket.on("get_chat", async (data) => {
      try {
        if (socket.role === "admin") return;
        const { chatId } = data;
        const userId = socket.userId;
        if (!chatId) {
          socket.emit("error", { message: "Chat id required" });
          return;
        }
        const check = await hasActiveSubscriptionAndVerification(userId);
        if (!check.ok) {
          socket.emit("error", {
            message:
              check.reason === "verification"
                ? "هذه الميزة تتطلب توثيق الهوية. يرجى توثيق حسابك أولاً"
                : "هذه الميزة متاحة فقط للمستخدمين المشتركين. يرجى ترقية اشتراكك للوصول إلى هذه الخدمة",
          });
          return;
        }

        const chat = await Chat.findOne({
          _id: chatId,
          isActive: true,
          $or: [
            { participants: userId },
            { guardians: userId },
          ],
        })
          .populate({
            path: "participants",
            select: "name profileImg isOnline lastSeen",
          })
          .populate({
            path: "lastMessage",
            select: "content sender messageType createdAt",
          })
          .lean();

        if (!chat) {
          socket.emit("error", { message: "Chat not found or access denied" });
          return;
        }

        const otherParticipantId = (chat.participants || []).find(
          (p) => (p._id || p).toString() !== userId.toString()
        );
        if (otherParticipantId) {
          const otherId = (
            otherParticipantId._id || otherParticipantId
          ).toString();
          const otherUser = await User.findById(otherId)
            .select("blockedUsers friends")
            .lean();
          if (otherUser) {
            const blockedIds = (otherUser.blockedUsers || []).map((id) =>
              id.toString()
            );
            if (blockedIds.includes(userId.toString())) {
              socket.emit("error", {
                message: "لا يمكنك فتح هذه المحادثة",
              });
              return;
            }
            const currentUser = await User.findById(userId)
              .select("friends")
              .lean();
            const myFriendIds = (currentUser?.friends || []).map((id) =>
              id.toString()
            );
            const otherFriendIds = (otherUser.friends || []).map((id) =>
              id.toString()
            );
            if (
              !myFriendIds.includes(otherId) ||
              !otherFriendIds.includes(userId.toString())
            ) {
              socket.emit("error", {
                message: "يجب أن تكونا أصدقاء لفتح المحادثة",
              });
              return;
            }
          }
        }

        const messages = await Message.find({ chat: chatId })
          .populate({
            path: "sender",
            select: "name profileImg isOnline",
          })
          .populate({
            path: "replyTo",
            select: "content sender messageType",
          })
          .sort({ createdAt: 1 })
          .limit(100)
          .lean();

        const unreadEntry = (chat.unreadCount || []).find(
          (c) => c.user && c.user.toString() === userId.toString()
        );
        const chatWithUnread = {
          ...chat,
          unreadCount: unreadEntry ? unreadEntry.count : 0,
        };

        socket.emit("chat_detail", {
          data: { chat: chatWithUnread, messages },
        });
      } catch (err) {
        console.error("get_chat error:", err);
        socket.emit("error", { message: "Failed to load chat" });
      }
    });

    // الانضمام لغرفة دردشة (للمحادثات الجديدة أو عند فتح محادثة)
    socket.on("join_chat", async (data) => {
      try {
        if (socket.role === "admin") return;
        const { chatId } = data;
        if (!chatId) return;
        const check = await hasActiveSubscriptionAndVerification(socket.userId);
        if (!check.ok) return;
        const chat = await Chat.findOne({
          _id: chatId,
          isActive: true,
          $or: [
            { participants: socket.userId },
            { guardians: socket.userId },
          ],
        });
        if (chat) {
          socket.join(chatId.toString());
          const key = `${socket.userId}:${chatId}`;
          lastOpenedChatAt.set(key, Date.now());
        }
      } catch (err) {
        console.error("join_chat error:", err);
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
        const check = await hasActiveSubscriptionAndVerification(socket.userId);
        if (!check.ok) return;

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

        const key = `${socket.userId}:${chatId}`;
        lastOpenedChatAt.set(key, Date.now());

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
      const userId = socket.userId;
      console.log(`🔌 [Chat Socket] User ${userId ?? "anonymous"} disconnected`);
      console.log(`🔌 [Chat Socket] Disconnect reason:`, reason);

      if (!userId) return;

      // إزالة المستخدم من القائمة المتصلة
      onlineUsers.delete(userId);

      // تحديث حالة المستخدم لتصبح غير متصل
      try {
        await User.findByIdAndUpdate(userId, {
          isOnline: false,
          lastSeen: new Date(),
        });
      } catch (err) {
        console.error("Disconnect: update user offline failed:", err.message);
      }

      // إرسال تحديث للجميع
      io.emit("user_offline", { userId });
    });

    // ping للحفاظ على الاتصال
    socket.on("ping", () => {
      socket.emit("pong");
    });
  });
};

module.exports = socketHandler;
