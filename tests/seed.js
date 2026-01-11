const User = require("../models/userModel");
const Post = require("../models/postModel");
const Chat = require("../models/chatModel");
const Message = require("../models/messageModel");

const seedFriendsAndChat = async () => {
  try {
    console.log("🤝 Seeding friends and chat data...");

    // Get existing users (skip admin)
    const users = await User.find({ role: { $ne: "admin" } }).limit(3);

    if (users.length < 2) {
      console.log(
        "❌ Not enough users to create friends/chat. Run seedDatabase first."
      );
      return;
    }

    // Clear existing friends data
    await User.updateMany({}, { $unset: { friends: 1 } });
    await Chat.deleteMany({});
    await Message.deleteMany({});

    // Create friendships
    const user1 = users[0];
    const user2 = users[1];
    const user3 = users.length > 2 ? users[2] : users[1];

    await User.findByIdAndUpdate(user1._id, {
      $push: { friends: [user2._id, user3._id] },
    });
    await User.findByIdAndUpdate(user2._id, {
      $push: { friends: [user1._id, user3._id] },
    });
    if (user3._id !== user2._id) {
      await User.findByIdAndUpdate(user3._id, {
        $push: { friends: [user1._id, user2._id] },
      });
    }

    console.log("✅ Created friendships");

    // Create a chat between first two users
    const chat = await Chat.create({
      participants: [user1._id, user2._id],
      chatType: "direct",
    });

    // Add some messages
    const message1 = await Message.create({
      chat: chat._id,
      sender: user1._id,
      content: "مرحبا! كيف حالك؟",
      messageType: "text",
    });

    const message2 = await Message.create({
      chat: chat._id,
      sender: user2._id,
      content: "أهلاً! بخير الحمد لله، وأنت؟",
      messageType: "text",
    });

    console.log("✅ Created sample chat and messages");
    console.log(`📊 Friends created: ${users.length}`);
    console.log("💬 Chat created: 1");
  } catch (error) {
    console.error("❌ Error seeding friends/chat data:", error);
  }
};

const seedDatabase = async () => {
  try {
    // Clear existing data
    await User.deleteMany({});
    await Post.deleteMany({});

    // Create admin user
    const adminUser = await User.create({
      name: "Admin User",
      email: "admin@datingapp.com",
      phone: "+1000000000",
      password: "admin123",
      age: 30,
      gender: "male",
      role: "admin",
    });

    // Create test users
    const users = await User.insertMany([
      {
        name: "Alice Johnson",
        email: "alice@example.com",
        phone: "+1234567891",
        password: "password123",
        age: 25,
        gender: "female",
        interestedIn: "male",
        minAgePreference: 22,
        maxAgePreference: 35,
        location: "New York",
        bio: "Love hiking and coding!",
        interests: ["coding", "hiking", "photography"],
        about:
          "I am a software developer who loves outdoor activities. Looking for someone to share adventures with!",
      },
      {
        name: "Bob Smith",
        email: "bob@example.com",
        phone: "+1234567892",
        password: "password123",
        age: 28,
        gender: "male",
        interestedIn: "female",
        minAgePreference: 23,
        maxAgePreference: 32,
        location: "New York",
        bio: "Coffee enthusiast and book lover",
        interests: ["reading", "coffee", "movies"],
        about:
          "Passionate about technology and literature. I enjoy quiet evenings with good books and great conversations.",
      },
      {
        name: "Charlie Brown",
        email: "charlie@example.com",
        phone: "+1234567893",
        password: "password123",
        age: 26,
        gender: "male",
        interestedIn: "both",
        minAgePreference: 20,
        maxAgePreference: 40,
        location: "Los Angeles",
        bio: "Artist and musician",
        interests: ["art", "music", "travel"],
        about:
          "Creative soul who expresses myself through art and music. Love exploring new places and meeting interesting people.",
      },
      {
        name: "Diana Prince",
        email: "diana@example.com",
        phone: "+1234567894",
        password: "password123",
        age: 27,
        gender: "female",
        interestedIn: "both",
        minAgePreference: 24,
        maxAgePreference: 35,
        location: "Chicago",
        bio: "Fitness instructor and health coach",
        interests: ["fitness", "health", "yoga"],
        about:
          "Dedicated to helping others live healthier lives. Passionate about wellness and personal growth.",
      },
      {
        name: "Eve Wilson",
        email: "eve@example.com",
        phone: "+1234567895",
        password: "password123",
        age: 24,
        gender: "female",
        interestedIn: "male",
        minAgePreference: 24,
        maxAgePreference: 30,
        location: "New York",
        bio: "Graduate student studying psychology",
        interests: ["psychology", "reading", "meditation"],
        about:
          "Psychology student with a passion for understanding human behavior. Love deep conversations and personal development.",
      },
    ]);

    // Create sample admin posts
    const posts = await Post.insertMany([
      {
        user: adminUser._id,
        title: "Welcome to Dating App!",
        content:
          "Welcome to our dating community! We hope you find meaningful connections here.",
        isAdminPost: true,
        images: ["welcome-image.jpg"],
      },
      {
        user: adminUser._id,
        title: "Safety Tips",
        content:
          "Remember to stay safe when meeting new people. Always meet in public places and inform someone you trust about your plans.",
        isAdminPost: true,
        images: ["safety-tips.jpg"],
      },
      {
        user: adminUser._id,
        title: "New Features Coming Soon!",
        content:
          "We are working on exciting new features including video calls and advanced matching algorithms. Stay tuned!",
        isAdminPost: true,
        images: ["new-features.jpg"],
      },
    ]);

    // Add some gallery items to users
    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const galleryItems = [
        {
          type: "image",
          url: `gallery-${user._id}-1.jpg`,
          caption: "My favorite photo",
          isPrimary: i === 0, // Make first user's first photo primary
        },
        {
          type: "image",
          url: `gallery-${user._id}-2.jpg`,
          caption: "Weekend adventure",
        },
      ];

      await User.findByIdAndUpdate(user._id, {
        gallery: galleryItems,
      });
    }

    console.log("✅ Database seeded successfully!");
    console.log(
      `Created ${users.length} users and ${posts.length} admin posts`
    );

    return { users, posts, adminUser };
  } catch (error) {
    console.error("❌ Error seeding database:", error);
    throw error;
  }
};

const clearDatabase = async () => {
  try {
    await User.deleteMany({});
    await Post.deleteMany({});
    console.log("✅ Database cleared successfully!");
  } catch (error) {
    console.error("❌ Error clearing database:", error);
    throw error;
  }
};

module.exports = {
  seedDatabase,
  seedFriendsAndChat,
  clearDatabase,
};
