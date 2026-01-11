module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.js"],
  collectCoverageFrom: [
    "routes/**/*.js",
    "services/**/*.js",
    "models/**/*.js",
    "utils/**/*.js",
    "middlewares/**/*.js",
    "!**/node_modules/**",
    "!**/tests/**",
    "!server.js",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  setupFilesAfterEnv: ["<rootDir>/tests/setup.js"],
  testTimeout: 10000,
  verbose: true,
  transform: {
    "^.+\\.js$": "babel-jest",
  },
  transformIgnorePatterns: ["node_modules/(?!(supertest)/)"],
};
