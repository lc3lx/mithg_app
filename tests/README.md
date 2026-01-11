# Testing Guide

This directory contains comprehensive tests for the Dating App backend API.

## Test Structure

```
tests/
├── auth.test.js          # Authentication API tests
├── userProfile.test.js   # User profile and gallery tests
├── matching.test.js      # Matching algorithm tests
├── performance.test.js   # Performance and load tests
├── seed.js              # Database seeding utilities
├── setup.js             # Jest setup and configuration
└── README.md            # This file
```

## Running Tests

### Run All Tests

```bash
npm test
```

### Run Tests with Coverage

```bash
npm run test:coverage
```

### Run Tests in Watch Mode

```bash
npm run test:watch
```

### Run Specific Test File

```bash
npm test auth.test.js
```

## Test Categories

### 1. Authentication Tests (`auth.test.js`)

- User registration validation
- Login functionality
- Password reset flow
- Input validation and error handling

### 2. User Profile Tests (`userProfile.test.js`)

- About section updates
- Gallery management (add, update, delete)
- Profile viewing and permissions
- File upload validation

### 3. Matching Tests (`matching.test.js`)

- Compatibility score calculation
- Match filtering and pagination
- Profile liking functionality
- Mutual friends detection
- Privacy and blocking features

### 4. Performance Tests (`performance.test.js`)

- Concurrent request handling
- Response time validation
- Rate limiting effectiveness
- Memory usage monitoring
- Database query optimization

## Test Data

Tests use seeded data that includes:

- Multiple test users with different profiles
- Sample posts and interactions
- Various relationship scenarios
- Edge cases and error conditions

## Database Setup

Tests run against an in-memory MongoDB database (`mongodb-memory-server`) to ensure:

- Clean state for each test
- No interference with development data
- Fast test execution
- Easy CI/CD integration

## Environment Variables for Testing

Tests use the following configuration:

```env
NODE_ENV=test
DB_URI=memory (auto-configured)
JWT_SECRET=test-jwt-secret
```

## Writing New Tests

### Test Structure Pattern

```javascript
describe("Feature Name", () => {
  let testData;

  beforeAll(async () => {
    // Setup test data
  });

  afterAll(async () => {
    // Cleanup
  });

  describe("Sub-feature", () => {
    it("should perform expected behavior", async () => {
      // Test implementation
      expect(result).toBe(expected);
    });
  });
});
```

### Testing API Endpoints

```javascript
const request = require("supertest");
const app = require("../server");

const response = await request(app)
  .method("/endpoint")
  .set("Authorization", `Bearer ${token}`)
  .send(data)
  .expect(statusCode);

expect(response.body).toHaveProperty("expectedProperty");
```

## Performance Benchmarks

### Expected Performance Metrics

- **API Response Time**: < 500ms for most endpoints
- **Database Queries**: < 100ms average
- **Concurrent Users**: Support 100+ simultaneous connections
- **Memory Usage**: < 100MB per test suite

### Monitoring Performance

```javascript
const startTime = Date.now();
// Perform operation
const endTime = Date.now();
const duration = endTime - startTime;

expect(duration).toBeLessThan(1000); // 1 second max
```

## Coverage Requirements

Target coverage metrics:

- **Statements**: > 80%
- **Branches**: > 75%
- **Functions**: > 85%
- **Lines**: > 80%

## Continuous Integration

Tests are designed to run in CI/CD pipelines:

- No external dependencies required
- Fast execution (< 30 seconds)
- Deterministic results
- Detailed reporting

## Debugging Tests

### Enable Debug Logging

```javascript
console.log("Debug info:", variable);
```

### Skip Tests Temporarily

```javascript
it.skip('should do something', () => { ... });
```

### Focus on Specific Test

```javascript
it.only('should do something', () => { ... });
```

## Contributing to Tests

When adding new features:

1. Write tests first (TDD approach)
2. Cover happy path and error cases
3. Include performance checks
4. Update this documentation
5. Ensure all tests pass

## Common Test Patterns

### Authentication Required Endpoints

```javascript
const token = await loginUser();
const response = await request(app)
  .get("/api/v1/protected-endpoint")
  .set("Authorization", `Bearer ${token}`);
```

### Database Assertions

```javascript
const user = await User.findById(id);
expect(user.field).toBe(expectedValue);
```

### Async Operations

```javascript
await expect(asyncOperation()).resolves.toBe(expected);
await expect(failingOperation()).rejects.toThrow("error message");
```
