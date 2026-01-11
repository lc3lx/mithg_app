const request = require('supertest');
const app = require('../server');
const User = require('../models/userModel');

describe('Authentication API', () => {
  beforeAll(async () => {
    // Clean up test data
    await User.deleteMany({ email: /test@/ });
  });

  afterAll(async () => {
    // Clean up after tests
    await User.deleteMany({ email: /test@/ });
  });

  describe('POST /api/v1/auth/signup', () => {
    it('should create a new user', async () => {
      const userData = {
        name: 'Test User',
        email: 'test@example.com',
        phone: '+1234567890',
        password: 'password123',
        age: 25,
        gender: 'male'
      };

      const response = await request(app)
        .post('/api/v1/auth/signup')
        .send(userData)
        .expect(201);

      expect(response.body).toHaveProperty('token');
      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data.user.email).toBe(userData.email);
    });

    it('should not create user with existing email', async () => {
      const userData = {
        name: 'Test User 2',
        email: 'test@example.com', // Same email
        phone: '+1234567891',
        password: 'password123',
        age: 25,
        gender: 'male'
      };

      await request(app)
        .post('/api/v1/auth/signup')
        .send(userData)
        .expect(400);
    });

    it('should validate required fields', async () => {
      const invalidData = {
        name: 'Test User'
        // Missing required fields
      };

      const response = await request(app)
        .post('/api/v1/auth/signup')
        .send(invalidData)
        .expect(400);

      expect(response.body).toHaveProperty('errors');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should login with correct credentials', async () => {
      const loginData = {
        email: 'test@example.com',
        password: 'password123'
      };

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send(loginData)
        .expect(200);

      expect(response.body).toHaveProperty('token');
      expect(response.body.data).toHaveProperty('user');
    });

    it('should not login with wrong password', async () => {
      const loginData = {
        email: 'test@example.com',
        password: 'wrongpassword'
      };

      await request(app)
        .post('/api/v1/auth/login')
        .send(loginData)
        .expect(401);
    });
  });
});
