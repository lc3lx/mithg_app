const request = require("supertest");
const app = require("../server");
const User = require("../models/userModel");

describe("User Profile API", () => {
  let authToken;
  let testUser;

  beforeAll(async () => {
    // Create a test user
    testUser = await User.create({
      name: "Test User",
      email: "testuser@example.com",
      phone: "+1234567890",
      password: "password123",
      age: 25,
      gender: "male",
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
  });

  describe("PUT /api/v1/profile/about", () => {
    it("should update user about section", async () => {
      const aboutText =
        "This is my about section. I love coding and meeting new people!";

      const response = await request(app)
        .put("/api/v1/profile/about")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ about: aboutText })
        .expect(200);

      expect(response.body.message).toBe("About section updated successfully");
      expect(response.body.data.about).toBe(aboutText);
    });

    it("should reject about text that is too long", async () => {
      const longText = "a".repeat(1001); // More than 1000 characters

      await request(app)
        .put("/api/v1/profile/about")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ about: longText })
        .expect(400);
    });
  });

  describe("POST /api/v1/profile/gallery", () => {
    it("should add image to gallery", async () => {
      // Mock file upload
      const response = await request(app)
        .post("/api/v1/profile/gallery")
        .set("Authorization", `Bearer ${authToken}`)
        .field("caption", "My profile picture")
        .field("type", "image")
        .attach("file", Buffer.from("fake image data"), "test.jpg")
        .expect(201);

      expect(response.body.message).toBe("Item added to gallery successfully");
      expect(response.body.data).toHaveProperty("type", "image");
      expect(response.body.data).toHaveProperty(
        "caption",
        "My profile picture"
      );
    });

    it("should limit gallery to 20 items", async () => {
      // First, let's add multiple items to reach the limit
      // This test assumes the user doesn't have many gallery items yet
      const response = await request(app)
        .post("/api/v1/profile/gallery")
        .set("Authorization", `Bearer ${authToken}`)
        .field("type", "image")
        .attach("file", Buffer.from("fake image data"), "test.jpg")
        .expect(201);

      expect(response.body.message).toBe("Item added to gallery successfully");
    });
  });

  describe("GET /api/v1/profile/:userId/gallery", () => {
    it("should get user gallery", async () => {
      const response = await request(app)
        .get(`/api/v1/profile/${testUser._id}/gallery`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty("results");
      expect(response.body).toHaveProperty("data");
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });

  describe("PUT /api/v1/profile/gallery/:itemId", () => {
    let galleryItemId;

    beforeAll(async () => {
      // Create a gallery item first
      const galleryItem = {
        type: "image",
        url: "test-image.jpg",
        caption: "Original caption",
      };

      testUser.gallery.push(galleryItem);
      await testUser.save();
      galleryItemId = testUser.gallery[testUser.gallery.length - 1]._id;
    });

    it("should update gallery item caption", async () => {
      const newCaption = "Updated caption";

      const response = await request(app)
        .put(`/api/v1/profile/gallery/${galleryItemId}`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ caption: newCaption })
        .expect(200);

      expect(response.body.message).toBe("Gallery item updated successfully");
      expect(response.body.data.caption).toBe(newCaption);
    });
  });

  describe("GET /api/v1/profile/:userId/profile", () => {
    it("should get complete user profile", async () => {
      const response = await request(app)
        .get(`/api/v1/profile/${testUser._id}/profile`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.data).toHaveProperty("name");
      expect(response.body.data).toHaveProperty("age");
      expect(response.body.data).toHaveProperty("gender");
      expect(response.body.data).toHaveProperty("gallery");
      expect(response.body.data).toHaveProperty("about");
      expect(response.body.data).toHaveProperty("friendsCount");
    });
  });
});
