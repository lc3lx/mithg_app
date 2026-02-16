const GuestSupportConversation = require("../models/guestSupportModel");

const supportGuestSocket = (io) => {
  const guestNamespace = io.of("/support-guest");

  guestNamespace.on("connection", (socket) => {
    let conversationId = null;

    socket.on("join", (data) => {
      const id = data?.conversationId;
      if (!id) return;
      conversationId = id;
      socket.join(`guest:${id}`);
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

        guestNamespace.to(`guest:${convId}`).emit("support_message", payload);
        const supportNamespace = io.of("/support");
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
