import { defineConfig, devices } from "@playwright/test";
const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:4173${base}/`,
    trace: "retain-on-failure",
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run start",
        env: { PORT: "4173", NEXT_PUBLIC_BASE_PATH: base },
        url: `http://127.0.0.1:4173${base}/`,
        reuseExistingServer: !process.env.CI,
      },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"], viewport: { width: 360, height: 800 } },
    },
    { name: "mobile-webkit", use: { ...devices["iPhone 13"] } },
  ],
});
