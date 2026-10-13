// Test-only limits and synthetic secrets; never production threshold recommendations.
export const REGISTRATION_TEST_ENV = {
  REPORT_REGISTRATION: "enabled",
  REPORT_REGISTRATION_MAX_PER_HOUR: "1000",
  REPORT_REGISTRATION_MAX_PER_DAY: "10000",
  RATE_LIMIT_KEY_PEPPER: "r".repeat(32),
  CHALLENGE_RATE_LIMITER: { limit: async () => ({ success: true }) },
};
