export type AppMode = "demo" | "production";

export const appMode: AppMode = process.env.APP_MODE === "production" ? "production" : "demo";
export const isDemoMode = appMode === "demo";
export const fabricIqRequested = process.env.FABRIC_IQ_ENABLED === "true";
export const fabricIqEnabled = !isDemoMode && fabricIqRequested;

export function requireProductionMode(feature: string) {
  if (isDemoMode) throw new Error(`${feature} is disabled while APP_MODE=demo.`);
}

export function requireProductionEnvironment(names: string[]) {
  requireProductionMode("Live service integration");
  const missing = names.filter((name) => !isProductionEnvironmentConfigured(name));
  if (missing.length) throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
}

export function isProductionEnvironmentConfigured(name: string) {
  const value = process.env[name]?.trim();
  return Boolean(
    value
    && !value.startsWith("replace-with-")
    && value !== "00000000-0000-0000-0000-000000000000"
    && !value.includes("user:password@"),
  );
}
