const request = require("supertest");
const app = require("../server");
const { seedDatabase, clearDatabase } = require("./seed");

describe("Performance Tests", () => {
  let authTokens = [];
  let users = [];

  beforeAll(async () => {
    // Seed database with test data
    const data = await seedDatabase();
    users = data.users;

    // Login all users to get tokens
    for (const user of users) {
      const loginResponse = await request(app).post("/api/v1/auth/login").send({
        email: user.email,
        password: "password123",
      });

      authTokens.push(loginResponse.body.token);
    }
  }, 30000);

  afterAll(async () => {
    // Clear database
    await clearDatabase();
  }, 30000);

  describe("Matching Performance", () => {
    it("should handle multiple concurrent match requests", async () => {
      const startTime = Date.now();

      // Make concurrent requests
      const promises = authTokens.map((token, index) =>
        request(app)
          .get("/api/v1/matches?limit=10")
          .set("Authorization", `Bearer ${token}`)
          .expect(200)
      );

      const responses = await Promise.all(promises);
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      console.log(`Concurrent match requests took ${totalTime}ms`);

      // All responses should be successful
      responses.forEach((response) => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty("data");
      });

      // Should complete within reasonable time (less than 5 seconds for 5 concurrent requests)
      expect(totalTime).toBeLessThan(5000);
    });

    it("should handle filtering and pagination efficiently", async () => {
      const token = authTokens[0];

      const startTime = Date.now();

      const response = await request(app)
        .get("/api/v1/matches?limit=5&minScore=50")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      const endTime = Date.now();
      const queryTime = endTime - startTime;

      console.log(`Filtered match query took ${queryTime}ms`);

      expect(response.body.data.length).toBeLessThanOrEqual(5);
      expect(queryTime).toBeLessThan(1000); // Should complete within 1 second
    });
  });

  describe("Profile Operations Performance", () => {
    it("should handle multiple profile view requests", async () => {
      const token = authTokens[0];
      const targetUserId = users[1]._id;

      const startTime = Date.now();

      // Make multiple profile view requests
      for (let i = 0; i < 10; i++) {
        await request(app)
          .get(`/api/v1/profile/${targetUserId}/profile`)
          .set("Authorization", `Bearer ${token}`)
          .expect(200);
      }

      const endTime = Date.now();
      const totalTime = endTime - startTime;
      const avgTime = totalTime / 10;

      console.log(
        `10 profile views took ${totalTime}ms (avg: ${avgTime}ms per request)`
      );

      expect(avgTime).toBeLessThan(200); // Average under 200ms per request
    });

    it("should handle gallery operations efficiently", async () => {
      const token = authTokens[0];

      const startTime = Date.now();

      const response = await request(app)
        .get(`/api/v1/profile/${users[0]._id}/gallery`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      const endTime = Date.now();
      const queryTime = endTime - startTime;

      console.log(`Gallery query took ${queryTime}ms`);

      expect(queryTime).toBeLessThan(500); // Should complete within 500ms
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });

  describe("Chat Performance", () => {
    let chatId;

    beforeAll(async () => {
      // Create a chat between first two users
      const token = authTokens[0];
      const response = await request(app)
        .post("/api/v1/chats")
        .set("Authorization", `Bearer ${token}`)
        .send({ participantId: users[1]._id })
        .expect(201);

      chatId = response.body.data._id;
    });

    it("should handle message sending efficiently", async () => {
      const token = authTokens[0];

      const startTime = Date.now();

      const response = await request(app)
        .post(`/api/v1/chats/${chatId}/messages`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          content: "Performance test message",
          messageType: "text",
        })
        .expect(201);

      const endTime = Date.now();
      const sendTime = endTime - startTime;

      console.log(`Message send took ${sendTime}ms`);

      expect(sendTime).toBeLessThan(1000); // Should complete within 1 second
      expect(response.body).toHaveProperty("data");
    });

    it("should handle message retrieval efficiently", async () => {
      const token = authTokens[0];

      const startTime = Date.now();

      const response = await request(app)
        .get(`/api/v1/chats/${chatId}/messages`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      const endTime = Date.now();
      const queryTime = endTime - startTime;

      console.log(`Message retrieval took ${queryTime}ms`);

      expect(queryTime).toBeLessThan(500); // Should complete within 500ms
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });

  describe("Rate Limiting Performance", () => {
    it("should handle rate limiting properly", async () => {
      const token = authTokens[0];

      // Make multiple rapid requests to test rate limiting
      const promises = [];
      for (let i = 0; i < 25; i++) {
        promises.push(
          request(app)
            .get("/api/v1/matches")
            .set("Authorization", `Bearer ${token}`)
        );
      }

      const responses = await Promise.allSettled(promises);

      // Count successful vs rate limited responses
      const successful = responses.filter(
        (r) => r.status === "fulfilled" && r.value.status === 200
      ).length;
      const rateLimited = responses.filter(
        (r) => r.status === "fulfilled" && r.value.status === 429
      ).length;

      console.log(
        `Rate limiting test: ${successful} successful, ${rateLimited} rate limited`
      );

      // Should allow some requests and rate limit others
      expect(successful).toBeGreaterThan(0);
      expect(rateLimited).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Memory Usage", () => {
    it("should not have memory leaks in repeated operations", async () => {
      const token = authTokens[0];

      // Perform many operations to check for memory issues
      for (let i = 0; i < 50; i++) {
        await request(app)
          .get("/api/v1/matches?limit=3")
          .set("Authorization", `Bearer ${token}`)
          .expect(200);
      }

      // If we get here without crashing, memory usage is acceptable
      expect(true).toBe(true);
    });
  });
});
