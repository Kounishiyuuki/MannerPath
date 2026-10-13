// Registration-only controls; existing keys' report submissions are independent.
// Missing policy pauses new registration. No guessed production thresholds.
export interface RegistrationBindings {
  REPORT_REGISTRATION?: string;
  REPORT_REGISTRATION_MAX_PER_HOUR?: string;
  REPORT_REGISTRATION_MAX_PER_DAY?: string;
}
export interface RegistrationBudget { hour: number; day: number }
export type RegistrationPolicy = { kind: "paused" } | { kind: "enabled"; budget: RegistrationBudget } | { kind: "misconfigured" };
function positiveInteger(value: string | undefined): number | null {
  if (value === undefined || !/^[1-9][0-9]*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
export function registrationPolicy(env: RegistrationBindings): RegistrationPolicy {
  if (env.REPORT_REGISTRATION === undefined || env.REPORT_REGISTRATION === "paused") return { kind: "paused" };
  if (env.REPORT_REGISTRATION !== "enabled") return { kind: "misconfigured" };
  const hour = positiveInteger(env.REPORT_REGISTRATION_MAX_PER_HOUR);
  const day = positiveInteger(env.REPORT_REGISTRATION_MAX_PER_DAY);
  if (hour === null || day === null || day < hour) return { kind: "misconfigured" };
  return { kind: "enabled", budget: { hour, day } };
}
