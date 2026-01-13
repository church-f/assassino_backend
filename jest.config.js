module.exports = {
  testEnvironment:  'node',
  coveragePathIgnorePatterns: ['/node_modules/'],
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    '**/*.js',
    '! **/node_modules/**',
    '!**/coverage/**',
    '!jest.config.js'
  ]
};