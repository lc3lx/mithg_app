const GuestSupportConversation = require("../models/guestSupportModel");

const supportGuestSocket = (io) => {
  const guestNamespace = io.of("/support-guest");
  const supportNamespace = io.of("/support");

  guestNamespace.on("connection", (socket) => {
    let conversationId = null;

    // بدء محادثة جديدة (اسم، هاتف، رسالة) — بدل REST POST /guest/contact
    socket.on("guest_start", async (data) => {
      try {
        const { name, phone, message } = data || {};
        if (!name || !name.trim() || !phone || !phone.trim()) {
          socket.emit("support_error", { message: "الاسم ورقم الهاتف مطلوبان" });
          return;
        }
        const firstMessage = {
          senderType: "guest",
          message: (message && message.trim()) || "أريد التواصل مع الدعم",
        };
        const conversation = await GuestSupportConversation.create({
          guestName: name.trim(),
          guestPhone: phone.trim(),
          messages: [firstMessage],
        });
        const convId = conversation._id.toString();
        const messagesPayload = (conversation.messages || []).map((m, i) => ({
          _id: m._id ? m._id.toString() : `${convId}_${i}`,
          senderType: m.senderType,
          message: m.message,
          createdAt: m.createdAt,
        }));
        supportNamespace.to("admins").emit("guest_new_thread", {
          conversationId: convId,
          guestName: conversation.guestName,
          guestPhone: conversation.guestPhone,
          lastMessage: firstMessage.message,
          lastMessageAt: conversation.createdAt,
          messages: conversation.messages,
        });
        socket.emit("guest_contact_created", {
          conversationId: convId,
          guestName: conversation.guestName,
          guestPhone: conversation.guestPhone,
          messages: messagesPayload,
        });
      } catch (error) {
        socket.emit("support_error", { message: "فشل بدء المحادثة" });
      }
    });

    socket.on("join", async (data) => {
      const id = data?.conversationId;
      if (!id) return;
      conversationId = id;
      socket.join(`guest:${id}`);
      try {
        const conversation = await GuestSupportConversation.findById(id).lean();
        if (!conversation) return;
        const messagesPayload = (conversation.messages || []).map((m, i) => ({
          _id: m._id ? m._id.toString() : `${id}_${i}`,
          senderType: m.senderType,
          message: m.message,
          createdAt: m.createdAt,
        }));
        socket.emit("guest_messages", { conversationId: id, messages: messagesPayload });
      } catch (err) {
        socket.emit("support_error", { message: "فشل تحميل الرسائل" });
      }
    });

    socket.on("support_guest_send", async (data) => {
      try {
        const { conversationId: convId, message } = data || {};
        if (!convId || !message || !message.trim()) return;

        const conversation = await GuestSupportConversation.findById(convId);
        if (!conversation) {
          socket.emit("support_error", { message: "المحادثة غير موجودة" });
          return;
        }

        conversation.messages.push({
          senderType: "guest",
          message: message.trim(),
        });
        await conversation.save();

        const lastMsg = conversation.messages[conversation.messages.length - 1];
        const payload = {
          conversationId: convId,
          guestName: conversation.guestName,
          guestPhone: conversation.guestPhone,
          senderType: "guest",
          message: lastMsg.message,
          createdAt: lastMsg.createdAt,
          _id: lastMsg._id,
        };

        // إرسال للأدمن فقط — الضيف يشوف رسالته من الـ optimistic update بالفرونت
        supportNamespace.to("admins").emit("support_message", payload);

        socket.emit("support_sent", { messageId: lastMsg._id });
      } catch (error) {
        socket.emit("support_error", { message: "فشل إرسال الرسالة" });
      }
    });

    socket.on("disconnect", () => {
      conversationId = null;
    });
  });
};

module.exports = supportGuestSocket;
