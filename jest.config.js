module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/packages/**/*.test.ts", "<rootDir>/test/**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  collectCoverageFrom: ["packages/**/*.ts", "test/**/*.ts"],
  coveragePathIgnorePatterns: ["/node_modules/", "/dist/", "/test/helpers.ts"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
        },
      },
    ],
  },
  testTimeout: 10000,
};
