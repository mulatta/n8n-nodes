module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/packages/**/*.test.ts", "<rootDir>/test/**/*.test.ts"],
  testPathIgnorePatterns: [
    "/node_modules/",
    "/dist/",
    "/packages/n8n-nodes-caldav/",
  ],
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
    // nostr-tools and @noble/* ship ESM .js; transpile them for Jest/CJS.
    "node_modules/(@noble|@scure|nostr-tools)/.+\\.js$": [
      "ts-jest",
      {
        tsconfig: {
          esModuleInterop: true,
          allowJs: true,
          allowSyntheticDefaultImports: true,
        },
      },
    ],
  },
  transformIgnorePatterns: ["node_modules/(?!nostr-tools|@noble|@scure)"],
  testTimeout: 10000,
};
