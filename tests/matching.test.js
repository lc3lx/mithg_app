const request = require("supertest");
const app = require("../server");
const User = require("../models/userModel");

describe("Matching API", () => {
  let authToken;
  let testUser;
  let otherUser;

  beforeAll(async () => {
    // Create test users
    testUser = await User.create({
      name: "Test User",
      email: "testuser@example.com",
      phone: "+1234567890",
      password: "password123",
      age: 25,
      gender: "male",
      interestedIn: "female",
      minAgePreference: 20,
      maxAgePreference: 30,
      location: "New York",
    });

    otherUser = await User.create({
      name: "Other User",
      email: "otheruser@example.com",
      phone: "+1234567891",
      password: "password123",
      age: 23,
      gender: "female",
      interestedIn: "male",
      minAgePreference: 20,
      maxAgePreference: 35,
      location: "New York",
      bio: "I love coding and hiking!",
      interests: ["coding", "hiking", "reading"],
    });

    // Login to get token
    const loginResponse = await request(app).post("/api/v1/auth/login").send({
      email: "testuser@example.com",
      password: "password123",
    });

    authToken = loginResponse.body.token;
  });

  afterAll(async () => {
    // Clean up
    await User.deleteMany({ email: /testuser@/ });
    await User.deleteMany({ email: /otheruser@/ });
  });

  describe("GET /api/v1/matches", () => {
    it("should get potential matches", async () => {
      const response = await request(app)
        .get("/api/v1/matches")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("results");
      expect(response.body).toHaveProperty("data");
      expect(Array.isArray(response.body.data)).toBe(true);

      // Should find the other user as a potential match
      if (response.body.results > 0) {
        const match = response.body.data.find(
          (m) => m._id === otherUser._id.toString()
        );
        if (match) {
          expect(match).toHaveProperty("compatibilityScore");
          expect(match.compatibilityScore).toBeGreaterThan(0);
        }
      }
    });

    it("should filter matches by minimum score", async () => {
      const response = await request(app)
        .get("/api/v1/matches?minScore=80")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("data");
      // All returned matches should have score >= 80
      response.body.data.forEach((match) => {
        expect(match.compatibilityScore).toBeGreaterThanOrEqual(80);
      });
    });

    it("should limit number of matches", async () => {
      const response = await request(app)
        .get("/api/v1/matches?limit=5")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data.length).toBeLessThanOrEqual(5);
    });
  });

  describe("GET /api/v1/matches/:userId", () => {
    it("should get detailed match profile", async () => {
      const response = await request(app)
        .get(`/api/v1/matches/${otherUser._id}`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data).toHaveProperty(
        "_id",
        otherUser._id.toString()
      );
      expect(response.body.data).toHaveProperty("compatibilityScore");
      expect(response.body.data).toHaveProperty("relationshipStatus");
      expect(response.body.data).toHaveProperty("gallery");
      expect(response.body.data).toHaveProperty("about");
    });

    it("should increment profile view count", async () => {
      const initialViews = otherUser.profileViews || 0;

      await request(app)
        .get(`/api/v1/matches/${otherUser._id}`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      // Refresh user data
      const updatedUser = await User.findById(otherUser._id);
      expect(updatedUser.profileViews).toBe(initialViews + 1);
    });

    it("should return 403 for blocked users", async () => {
      // Add otherUser to testUser's blocked list
      await User.findByIdAndUpdate(testUser._id, {
        $push: { blockedUsers: otherUser._id },
      });

      await request(app)
        .get(`/api/v1/matches/${otherUser._id}`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(403);

      // Remove from blocked list
      await User.findByIdAndUpdate(testUser._id, {
        $pull: { blockedUsers: otherUser._id },
      });
    });
  });

  describe("POST /api/v1/matches/:userId/like", () => {
    it("should like a user profile", async () => {
      const response = await request(app)
        .post(`/api/v1/matches/${otherUser._id}/like`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.message).toBe("Profile liked successfully");

      // Check that likesReceived was incremented
      const updatedUser = await User.findById(otherUser._id);
      expect(updatedUser.likesReceived).toBe(
        (otherUser.likesReceived || 0) + 1
      );
    });

    it("should not allow liking friends", async () => {
      // Make them friends first
      await User.findByIdAndUpdate(testUser._id, {
        $push: { friends: otherUser._id },
      });
      await User.findByIdAndUpdate(otherUser._id, {
        $push: { friends: testUser._id },
      });

      await request(app)
        .post(`/api/v1/matches/${otherUser._id}/like`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(400);

      // Remove friendship
      await User.findByIdAndUpdate(testUser._id, {
        $pull: { friends: otherUser._id },
      });
      await User.findByIdAndUpdate(otherUser._id, {
        $pull: { friends: testUser._id },
      });
    });
  });

  describe("GET /api/v1/matches/:userId/mutual-friends", () => {
    let mutualFriend;

    beforeAll(async () => {
      // Create a mutual friend
      mutualFriend = await User.create({
        name: "Mutual Friend",
        email: "mutual@example.com",
        phone: "+1234567892",
        password: "password123",
        age: 26,
        gender: "male",
      });

      // Add mutual friend to both users
      await User.findByIdAndUpdate(testUser._id, {
        $push: { friends: mutualFriend._id },
      });
      await User.findByIdAndUpdate(otherUser._id, {
        $push: { friends: mutualFriend._id },
      });
      await User.findByIdAndUpdate(mutualFriend._id, {
        $push: { friends: [testUser._id, otherUser._id] },
      });
    });

    afterAll(async () => {
      // Clean up mutual friend
      await User.deleteMany({ email: /mutual@/ });
    });

    it("should get mutual friends", async () => {
      const response = await request(app)
        .get(`/api/v1/matches/${otherUser._id}/mutual-friends`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("results");
      expect(response.body).toHaveProperty("data");
      expect(Array.isArray(response.body.data)).toBe(true);

      // Should find the mutual friend
      if (response.body.results > 0) {
        const mutual = response.body.data.find(
          (f) => f._id === mutualFriend._id.toString()
        );
        expect(mutual).toBeDefined();
        expect(mutual.name).toBe("Mutual Friend");
      }
    });
  });
});
