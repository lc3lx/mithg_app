const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
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

const onlineUsers = new Map();
const lastOpenedChatAt = new Map();
const lastMessageNotificationAt = new Map();

const buildBlockedUserPayload = (user, { forSelf = false } = {}) => {
  const isActive =
    !!(
      user &&
      user.isBlocked === true &&
      user.blockedUntil &&
      new Date(user.blockedUntil) > new Date()
    );
  const isFullBlock = isActive ? isFullOrPermanentBlock(user) : false;
  const blockedUntil = isActive && user.blockedUntil
    ? new Date(user.blockedUntil).toISOString()
    : null;

  if (!isActive) {
    return { active: false, fullBlock: false, blockedUntil: null, message: null };
  }

  const message = forSelf
    ? (isFullBlock
        ? "أنت محظور بشكل كامل."
        : `أنت محظور حتى ${new Date(user.blockedUntil).toLocaleString("ar-SA")}`)
    : "الطرف الآخر محظور حالياً.";

  return { active: true, fullBlock: isFullBlock, blockedUntil, message };
};

// --- Per-socket caches (avoids repeated DB hits during a connection) ---
const SUB_CHECK_TTL = 60_000;
const FRIENDS_CACHE_TTL = 30_000;

const cachedSubCheck = async (socket) => {
  const now = Date.now();
  if (socket._subCheck && now - socket._subCheckAt < SUB_CHECK_TTL) {
    return socket._subCheck;
  }
  socket._subCheck = await hasActiveSubscriptionAndVerification(socket.userId);
  socket._subCheckAt = now;
  return socket._subCheck;
};

const cachedFriendIds = async (socket) => {
  const now = Date.now();
  if (socket._friendIds && now - socket._friendIdsAt < FRIENDS_CACHE_TTL) {
    return socket._friendIds;
  }
  const user = await User.findById(socket.userId).select("friends").lean();
  socket._friendIds = new Set((user?.friends || []).map((id) => id.toString()));
  socket._friendIdsAt = now;
  return socket._friendIds;
};

const invalidateFriendsCache = (socket) => {
  socket._friendIds = null;
  socket._friendIdsAt = 0;
};

const socketDebounce = (socket, key, fn, delayMs = 500) => {
  if (!socket._debounceTimers) socket._debounceTimers = {};
  clearTimeout(socket._debounceTimers[key]);
  socket._debounceTimers[key] = setTimeout(fn, delayMs);
};

// Helper: skip Mongoose auto-populate hooks
const SKIP_AUTO_POPULATE = { _skipAutoPopulate: true };

const socketHandler = (io) => {
  const chatNamespace = io.of("/chat");

  chatNamespace.use(async (socket, next) => {
    try {
      const { token } = socket.handshake.auth;
      if (!token) {
        return next(new Error("Authentication error: No token provided"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);

      if (decoded.adminId) {
        const admin = await Admin.findById(decoded.adminId).lean();
        if (!admin) return next(new Error("Admin not found"));
        socket.role = "admin";
        socket.adminId = decoded.adminId;
        return next();
      }

      // Cache user data on socket — avoids repeated User.findById in event handlers
      const user = await User.findById(decoded.userId)
        .select("name profileImg friends isBlocked blockedUntil blockedIdentifiers")
        .lean();
      if (!user) return next(new Error("User not found"));

      socket.role = "user";
      socket.userId = decoded.userId;
      socket.user = user;
      next();
    } catch (error) {
      next(new Error(`Authentication error: ${error.message}`));
    }
  });

  chatNamespace.on("connection", async (socket) => {
    socket.on("error", (error) => {
      const msg = error && error.message ? error.message : String(error);
      if (msg.includes("invalid payload")) {
        console.warn("⚠️ [Chat Socket] Invalid payload — disconnecting for clean reconnect.");
      }
      try { socket.disconnect(true); } catch (_) {}
    });

    if (socket.role === "admin") {
      socket.join("admin_chat_monitoring");
      return;
    }

    const userId = socket.userId;
    onlineUsers.set(userId, socket.id);

    // Uses _skipAutoPopulate — only needs _id and unreadCount, not full participant/message data.
    // Without this flag, the pre-find hook would trigger 4 additional populate queries across
    // ALL user chats on every connection/reconnection.
    const [, userChats] = await Promise.all([
      User.findByIdAndUpdate(userId, { isOnline: true, lastSeen: new Date() }),
      Chat.find({ participants: userId, isActive: true })
        .select("_id unreadCount")
        .setOptions(SKIP_AUTO_POPULATE)
        .lean(),
    ]);

    chatNamespace.emit("user_online", { userId });

    // Batch unread emissions into a single payload instead of N individual emits
    const unreadBatch = [];
    for (const chat of userChats) {
      socket.join(chat._id.toString());
      const unreadEntry = (chat.unreadCount || []).find(
        (c) => c.user && c.user.toString() === userId
      );
      if (unreadEntry && unreadEntry.count > 0) {
        unreadBatch.push({ chatId: chat._id, count: unreadEntry.count });
      }
    }
    if (unreadBatch.length > 0) {
      socket.emit("chat_unread_batch", unreadBatch);
      // Also emit individual events for backward compatibility
      for (const entry of unreadBatch) {
        socket.emit("chat_unread_count", entry);
      }
    }

    // =============================================
    // open_chat — single event replaces join + get_chat + mark_as_read
    // Uses aggregation pipelines to bypass Mongoose hooks entirely
    // =============================================
    socket.on("open_chat", async (data) => {
      try {
        const { chatId } = data || {};
        if (!chatId) {
          socket.emit("error", { message: "Chat id required" });
          return;
        }

        const check = await cachedSubCheck(socket);
        if (!check.ok) {
          socket.emit("error", {
            message: check.reason === "verification"
              ? "هذه الميزة تتطلب توثيق الهوية. يرجى توثيق حسابك أولاً"
              : "هذه الميزة متاحة فقط للمستخدمين المشتركين. يرجى ترقية اشتراكك للوصول إلى هذه الخدمة",
          });
          return;
        }

        const chatOId = new mongoose.Types.ObjectId(chatId);
        const userOId = new mongoose.Types.ObjectId(userId);

        // SINGLE AGGREGATION: chat + participants + lastMessage in one DB round-trip.
        // Bypasses all Mongoose middleware (pre-find hooks, auto-populate).
        // Replaces: Chat.findOne + populate(participants) + populate(lastMessage) + populate(sender)
        // = 4 queries → 1 aggregation
        const chatAgg = await Chat.aggregate([
          {
            $match: {
              _id: chatOId,
              isActive: true,
              $or: [{ participants: userOId }, { guardians: userOId }],
            },
          },
          {
            $lookup: {
              from: "users",
              localField: "participants",
              foreignField: "_id",
              pipeline: [
                { $project: { name: 1, profileImg: 1, isOnline: 1, lastSeen: 1 } },
              ],
              as: "participants",
            },
          },
          {
            $lookup: {
              from: "messages",
              localField: "lastMessage",
              foreignField: "_id",
              pipeline: [
                { $project: { content: 1, sender: 1, messageType: 1, createdAt: 1 } },
              ],
              as: "lastMessageDoc",
            },
          },
          { $unwind: { path: "$lastMessageDoc", preserveNullAndEmptyArrays: true } },
          {
            $addFields: {
              lastMessage: { $ifNull: ["$lastMessageDoc", null] },
            },
          },
          { $project: { lastMessageDoc: 0 } },
          { $limit: 1 },
        ]);

        if (!chatAgg || chatAgg.length === 0) {
          socket.emit("error", { message: "Chat not found or access denied" });
          return;
        }

        const chat = chatAgg[0];

        // Validate friendship and blocks using cached user data on socket
        const otherParticipant = (chat.participants || []).find(
          (p) => p._id.toString() !== userId.toString()
        );

        let otherUser = null;
        if (otherParticipant) {
          const otherId = otherParticipant._id.toString();
          // Single query for other user — only the fields we need for validation
          otherUser = await User.findById(otherId)
            .select("blockedUsers friends isBlocked blockedUntil blockedIdentifiers")
            .lean();

          if (otherUser) {
            const blockedIds = (otherUser.blockedUsers || []).map((id) => id.toString());
            if (blockedIds.includes(userId.toString())) {
              socket.emit("error", { message: "لا يمكنك فتح هذه المحادثة" });
              return;
            }
            // Use cached friends from socket.user (set during auth)
            const myFriendIds = (socket.user?.friends || []).map((id) => id.toString());
            const otherFriendIds = (otherUser.friends || []).map((id) => id.toString());
            if (!myFriendIds.includes(otherId) || !otherFriendIds.includes(userId.toString())) {
              socket.emit("error", { message: "يجب أن تكونا أصدقاء لفتح المحادثة" });
              return;
            }
          }
        }

        // MESSAGES AGGREGATION: messages + sender + replyTo in one DB round-trip.
        // Bypasses Message pre-find hooks (auto-populate sender + replyTo).
        // Replaces: Message.find + populate(sender) + populate(replyTo + nested sender) = 3 queries → 1
        // PARALLEL with mark-as-read + reset-unread (3 operations, 1 round-trip each)
        const [messages] = await Promise.all([
          Message.aggregate([
            { $match: { chat: chatOId } },
            { $sort: { createdAt: 1 } },
            { $limit: 100 },
            {
              $lookup: {
                from: "users",
                localField: "sender",
                foreignField: "_id",
                pipeline: [{ $project: { name: 1, profileImg: 1, isOnline: 1 } }],
                as: "senderDoc",
              },
            },
            { $unwind: { path: "$senderDoc", preserveNullAndEmptyArrays: true } },
            {
              $lookup: {
                from: "messages",
                localField: "replyTo",
                foreignField: "_id",
                pipeline: [
                  { $project: { content: 1, sender: 1, messageType: 1 } },
                  {
                    $lookup: {
                      from: "users",
                      localField: "sender",
                      foreignField: "_id",
                      pipeline: [{ $project: { name: 1 } }],
                      as: "senderDoc",
                    },
                  },
                  { $unwind: { path: "$senderDoc", preserveNullAndEmptyArrays: true } },
                  { $addFields: { sender: { $ifNull: ["$senderDoc", "$sender"] } } },
                  { $project: { senderDoc: 0 } },
                ],
                as: "replyToDoc",
              },
            },
            { $unwind: { path: "$replyToDoc", preserveNullAndEmptyArrays: true } },
            {
              $addFields: {
                sender: { $ifNull: ["$senderDoc", "$sender"] },
                replyTo: { $ifNull: ["$replyToDoc", null] },
              },
            },
            { $project: { senderDoc: 0, replyToDoc: 0 } },
          ]),
          Message.updateMany(
            { chat: chatOId, sender: { $ne: userOId }, isRead: false },
            { isRead: true, readAt: new Date() }
          ),
          Chat.findByIdAndUpdate(chatOId, {
            $pull: { unreadCount: { user: userOId } },
          }),
        ]);

        // Fix mediaUrl for messages (since we bypass the post-init hook)
        const baseUrl = process.env.BASE_URL;
        for (const msg of messages) {
          if (msg.mediaUrl && !msg.mediaUrl.startsWith("http")) {
            msg.mediaUrl = `${baseUrl}/uploads/messages/${msg.mediaUrl}`;
          }
        }

        socket.join(chatId.toString());
        lastOpenedChatAt.set(`${userId}:${chatId}`, Date.now());

        // Use cached user data from socket instead of re-querying
        const selfBlock = buildBlockedUserPayload(socket.user, { forSelf: true });
        const otherBlock = buildBlockedUserPayload(otherUser, { forSelf: false });

        const unreadEntry = (chat.unreadCount || []).find(
          (c) => c.user && c.user.toString() === userId.toString()
        );

        socket.emit("chat_detail", {
          data: {
            chat: { ...chat, unreadCount: unreadEntry ? unreadEntry.count : 0 },
            messages,
            selfBlock,
            otherBlock,
          },
        });

        chatNamespace.to(chatId).emit("messages_read", { chatId, userId });
        chatNamespace.to("admin_chat_monitoring").emit("messages_read", { chatId, userId });
      } catch (err) {
        console.error("open_chat error:", err.message);
        socket.emit("error", { message: "Failed to load chat" });
      }
    });

    // =============================================
    // get_chats — uses _skipAutoPopulate + cached friends
    // =============================================
    socket.on("get_chats", async () => {
      try {
        if (socket.role === "admin") return;

        const check = await cachedSubCheck(socket);
        if (!check.ok) {
          socket.emit("error", {
            message: check.reason === "verification"
              ? "هذه الميزة تتطلب توثيق الهوية. يرجى توثيق حسابك أولاً"
              : "هذه الميزة متاحة فقط للمستخدمين المشتركين. يرجى ترقية اشتراكك للوصول إلى هذه الخدمة",
          });
          return;
        }

        // Use cached friends — avoids User.findById on every get_chats call
        const [friendIds, chats] = await Promise.all([
          cachedFriendIds(socket),
          Chat.find({ participants: userId, isActive: true })
            .populate({ path: "participants", select: "name profileImg isOnline lastSeen" })
            .populate({
              path: "lastMessage",
              select: "content sender messageType createdAt isRead",
              populate: { path: "sender", select: "name" },
            })
            .sort({ lastMessageTime: -1 })
            .setOptions(SKIP_AUTO_POPULATE)
            .lean(),
        ]);

        // Collect other participant IDs for single block-check query
        const otherIds = [];
        for (const c of chats) {
          const other = (c.participants || []).find(
            (p) => (p._id || p).toString() !== userId.toString()
          );
          if (other) otherIds.push((other._id || other).toString());
        }

        const blockedSet = otherIds.length > 0
          ? new Set(
              await User.find(
                { _id: { $in: otherIds }, blockedUsers: userId },
                { _id: 1 }
              ).lean().then((list) => list.map((u) => u._id.toString()))
            )
          : new Set();

        const result = [];
        for (const c of chats) {
          const other = (c.participants || []).find(
            (p) => (p._id || p).toString() !== userId.toString()
          );
          if (other) {
            const otherId = (other._id || other).toString();
            if (blockedSet.has(otherId) || !friendIds.has(otherId)) continue;
          }
          const unreadEntry = (c.unreadCount || []).find(
            (uc) => uc.user && uc.user.toString() === userId.toString()
          );
          result.push({ ...c, unreadCount: unreadEntry ? unreadEntry.count : 0 });
        }

        socket.emit("chats_list", { data: result });
      } catch (err) {
        console.error("get_chats error:", err.message);
        socket.emit("error", { message: "Failed to load chats" });
      }
    });

    // =============================================
    // send_message — uses socket.user cache, skips auto-populate
    // =============================================
    socket.on("send_message", async (data) => {
      try {
        if (socket.role === "admin") {
          socket.emit("error", { message: "Admins cannot send messages" });
          return;
        }
        const { chatId, content, messageType = "text", clientTempId } = data;

        // Skip auto-populate: we only need to verify the user is a participant
        const chat = await Chat.findOne({
          _id: chatId,
          isActive: true,
          $or: [{ participants: socket.userId }, { guardians: socket.userId }],
        })
          .select("_id participants")
          .setOptions(SKIP_AUTO_POPULATE)
          .lean();

        if (!chat) {
          socket.emit("error", { message: "Chat not found or access denied" });
          return;
        }

        const check = await cachedSubCheck(socket);
        if (!check.ok) {
          socket.emit("error", {
            message: check.reason === "verification"
              ? "هذه الميزة تتطلب توثيق الهوية. يرجى توثيق حسابك أولاً"
              : "إرسال الرسائل متاح فقط للمستخدمين المشتركين. يرجى ترقية اشتراكك لإمكانية المراسلة",
          });
          return;
        }

        // Use cached user data from socket instead of querying DB again
        const user = socket.user;
        if (!user) return;

        if (user.isBlocked && user.blockedUntil && new Date(user.blockedUntil) > new Date()) {
          const isFullBlock = isFullOrPermanentBlock(user);
          socket.emit("error", {
            code: "USER_BLOCKED",
            blockedUntil: user.blockedUntil ? new Date(user.blockedUntil).toISOString() : null,
            fullBlock: isFullBlock,
            message: isFullBlock
              ? "أنت محظور بشكل كامل."
              : `أنت محظور حتى ${new Date(user.blockedUntil).toLocaleString("ar-SA")}`,
          });
          return;
        }

        const myIdStr = socket.userId.toString();
        const otherParticipantIds = (chat.participants || [])
          .map((p) => {
            const id = p._id || p.id || p;
            return id ? id.toString() : null;
          })
          .filter(Boolean)
          .filter((id) => id !== myIdStr);

        if (otherParticipantIds.length > 0) {
          const otherUser = await User.findById(otherParticipantIds[0])
            .select("friends blockedUsers")
            .lean();
          if (otherUser) {
            const otherBlocked = (otherUser.blockedUsers || []).map((id) => id.toString());
            if (otherBlocked.includes(myIdStr)) {
              socket.emit("error", { message: "تم حظرك من قبل هذا المستخدم" });
              return;
            }
            const otherFriends = (otherUser.friends || []).map((id) => id.toString());
            if (!otherFriends.includes(myIdStr)) {
              socket.emit("error", { message: "لا يمكنك إرسال رسائل بعد إلغاء الصداقة" });
              return;
            }
          }
        }

        let warningResult = null;
        if (content && messageType === "text") {
          try {
            const mockReq = { body: { message: content, userId: socket.userId, chatId } };
            const mockRes = { status: () => ({ json: (d) => { warningResult = d; return d; } }) };
            await checkMessageAndWarn(mockReq, mockRes, () => {});
          } catch (_) {}
        }

        let contentToStore = content;
        if (content && typeof content === "string") {
          contentToStore = await BannedWords.maskMessage(content);
        }

        const messageData = { chat: chatId, sender: socket.userId, messageType };
        if (contentToStore) messageData.content = contentToStore;

        const message = await Message.create(messageData);
        await message.populate([{ path: "sender", select: "name profileImg" }]);

        const messagePayload = {
          chatId,
          message: message.toObject ? message.toObject() : message,
          ...(clientTempId ? { clientTempId } : {}),
        };

        chatNamespace.to(chatId).emit("new_message", messagePayload);
        chatNamespace.to("admin_chat_monitoring").emit("new_message", messagePayload);

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

        // Background: notifications only (chat metadata is handled by Message post-save hook)
        setImmediate(async () => {
          try {
            const roomChatId = chatId.toString();
            const socketsInChatRoom = chatNamespace.adapter.rooms?.get(roomChatId);

            const isViewing = (pid) => {
              const sid = onlineUsers.get(pid.toString());
              return !!(sid && socketsInChatRoom && socketsInChatRoom.has(sid));
            };

            // Emit unread counts to participants not currently viewing
            await Promise.all(
              otherParticipantIds.map(async (participantId) => {
                if (isViewing(participantId)) return;
                const sid = onlineUsers.get(participantId.toString());
                if (!sid) return;
                // Use skipAutoPopulate for unread count lookup
                const chatDoc = await Chat.findById(chatId)
                  .select("unreadCount")
                  .setOptions(SKIP_AUTO_POPULATE)
                  .lean();
                if (!chatDoc) return;
                const entry = (chatDoc.unreadCount || []).find(
                  (c) => c.user && c.user.toString() === participantId
                );
                chatNamespace.to(sid).emit("chat_unread_count", {
                  chatId,
                  count: entry ? entry.count : 0,
                });
              })
            );

            const shouldNotify = (participantId) => {
              if (isViewing(participantId)) return false;
              const key = `${participantId}:${chatId}`;
              const lastNotif = lastMessageNotificationAt.get(key);
              const lastOpened = lastOpenedChatAt.get(key);
              return !(lastNotif != null && (lastOpened == null || lastOpened < lastNotif));
            };

            await Promise.all(
              otherParticipantIds.map(async (participantId) => {
                if (!shouldNotify(participantId)) return;
                const key = `${participantId}:${chatId}`;
                lastMessageNotificationAt.set(key, Date.now());
                await Notification.createNotification({
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
          } catch (err) {
            console.error("Chat background update error:", err.message);
          }
        });
      } catch (error) {
        console.error("Send message error:", error.message);
        socket.emit("error", { message: "Failed to send message" });
      }
    });

    // =============================================
    // Legacy: get_chat (kept for backward compat / block polling)
    // =============================================
    socket.on("get_chat", async (data) => {
      try {
        if (socket.role === "admin") return;
        const { chatId } = data;
        if (!chatId) {
          socket.emit("error", { message: "Chat id required" });
          return;
        }
        const check = await cachedSubCheck(socket);
        if (!check.ok) {
          socket.emit("error", {
            message: check.reason === "verification"
              ? "هذه الميزة تتطلب توثيق الهوية. يرجى توثيق حسابك أولاً"
              : "هذه الميزة متاحة فقط للمستخدمين المشتركين. يرجى ترقية اشتراكك للوصول إلى هذه الخدمة",
          });
          return;
        }

        const [chat, selfUser] = await Promise.all([
          Chat.findOne({
            _id: chatId,
            isActive: true,
            $or: [{ participants: userId }, { guardians: userId }],
          })
            .populate({ path: "participants", select: "name profileImg isOnline lastSeen" })
            .populate({ path: "lastMessage", select: "content sender messageType createdAt" })
            .setOptions(SKIP_AUTO_POPULATE)
            .lean(),
          Promise.resolve(socket.user),
        ]);

        if (!chat) {
          socket.emit("error", { message: "Chat not found or access denied" });
          return;
        }

        const otherParticipantId = (chat.participants || []).find(
          (p) => (p._id || p).toString() !== userId.toString()
        );
        let otherUser = null;
        if (otherParticipantId) {
          const otherId = (otherParticipantId._id || otherParticipantId).toString();
          otherUser = await User.findById(otherId)
            .select("blockedUsers friends isBlocked blockedUntil blockedIdentifiers")
            .lean();
          if (otherUser) {
            const blockedIds = (otherUser.blockedUsers || []).map((id) => id.toString());
            if (blockedIds.includes(userId.toString())) {
              socket.emit("error", { message: "لا يمكنك فتح هذه المحادثة" });
              return;
            }
            const myFriendIds = (selfUser?.friends || []).map((id) => id.toString());
            const otherFriendIds = (otherUser.friends || []).map((id) => id.toString());
            if (!myFriendIds.includes(otherId) || !otherFriendIds.includes(userId.toString())) {
              socket.emit("error", { message: "يجب أن تكونا أصدقاء لفتح المحادثة" });
              return;
            }
          }
        }

        const messages = await Message.find({ chat: chatId })
          .populate({ path: "sender", select: "name profileImg isOnline" })
          .populate({ path: "replyTo", select: "content sender messageType" })
          .sort({ createdAt: 1 })
          .limit(100)
          .setOptions(SKIP_AUTO_POPULATE)
          .lean();

        const unreadEntry = (chat.unreadCount || []).find(
          (c) => c.user && c.user.toString() === userId.toString()
        );

        const selfBlock = buildBlockedUserPayload(selfUser, { forSelf: true });
        const otherBlock = buildBlockedUserPayload(otherUser, { forSelf: false });

        socket.emit("chat_detail", {
          data: {
            chat: { ...chat, unreadCount: unreadEntry ? unreadEntry.count : 0 },
            messages,
            selfBlock,
            otherBlock,
          },
        });
      } catch (err) {
        console.error("get_chat error:", err.message);
        socket.emit("error", { message: "Failed to load chat" });
      }
    });

    // join_chat
    socket.on("join_chat", async (data) => {
      try {
        if (socket.role === "admin") return;
        const { chatId } = data;
        if (!chatId) return;
        const chat = await Chat.findOne({
          _id: chatId,
          isActive: true,
          $or: [{ participants: socket.userId }, { guardians: socket.userId }],
        })
          .select("_id")
          .setOptions(SKIP_AUTO_POPULATE)
          .lean();
        if (chat) {
          socket.join(chatId.toString());
          lastOpenedChatAt.set(`${socket.userId}:${chatId}`, Date.now());
        }
      } catch (err) {
        console.error("join_chat error:", err.message);
      }
    });

    // mark_as_read
    socket.on("mark_as_read", async (data) => {
      try {
        if (socket.role === "admin") return;
        const { chatId } = data;
        const chat = await Chat.findOne({
          _id: chatId,
          isActive: true,
          $or: [{ participants: socket.userId }, { guardians: socket.userId }],
        })
          .select("_id")
          .setOptions(SKIP_AUTO_POPULATE)
          .lean();

        if (!chat) return;

        lastOpenedChatAt.set(`${socket.userId}:${chatId}`, Date.now());

        await Promise.all([
          Message.updateMany(
            { chat: chatId, sender: { $ne: socket.userId }, isRead: false },
            { isRead: true, readAt: new Date() }
          ),
          Chat.findByIdAndUpdate(chatId, {
            $pull: { unreadCount: { user: socket.userId } },
          }),
        ]);

        chatNamespace.to(chatId).emit("messages_read", { chatId, userId: socket.userId });
        chatNamespace.to("admin_chat_monitoring").emit("messages_read", { chatId, userId: socket.userId });
      } catch (error) {
        console.error("Mark as read error:", error.message);
      }
    });

    // typing indicators
    socket.on("typing_start", (data) => {
      const { chatId } = data;
      socket.to(chatId).emit("user_typing", {
        chatId, userId: socket.userId, userName: socket.user.name, isTyping: true,
      });
    });

    socket.on("typing_stop", (data) => {
      const { chatId } = data;
      socket.to(chatId).emit("user_typing", {
        chatId, userId: socket.userId, userName: socket.user.name, isTyping: false,
      });
    });

    // send_like
    socket.on("send_like", async (data) => {
      try {
        const { userId: targetUserId } = data;
        const targetUser = await User.findById(targetUserId).select("_id").lean();
        if (!targetUser) {
          socket.emit("error", { message: "User not found" });
          return;
        }

        await User.findByIdAndUpdate(targetUserId, { $inc: { likesReceived: 1 } });

        await Notification.createNotification({
          user: targetUserId,
          type: "profile_view",
          title: "Profile Liked",
          message: `${socket.user.name} liked your profile`,
          relatedUser: socket.userId,
          data: { action: "like" },
        });

        const targetSocketId = onlineUsers.get(targetUserId);
        if (targetSocketId) {
          const unreadCount = await Notification.countDocuments({ user: targetUserId, isRead: false });
          chatNamespace.to(targetSocketId).emit("notification", {
            type: "profile_like",
            title: "Profile Liked",
            message: `${socket.user.name} liked your profile`,
            unreadCount,
          });
        }

        socket.emit("like_sent", { targetUserId });
      } catch (error) {
        console.error("Send like error:", error.message);
        socket.emit("error", { message: "Failed to send like" });
      }
    });

    // disconnect
    socket.on("disconnect", async (reason) => {
      if (!socket.userId) return;
      onlineUsers.delete(socket.userId);
      if (socket._debounceTimers) {
        Object.values(socket._debounceTimers).forEach(clearTimeout);
      }
      try {
        await User.findByIdAndUpdate(socket.userId, { isOnline: false, lastSeen: new Date() });
      } catch (_) {}
      io.emit("user_offline", { userId: socket.userId });
    });

    socket.on("ping", () => socket.emit("pong"));
  });
};

module.exports = socketHandler;
