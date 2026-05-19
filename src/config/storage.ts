export type StoragePlanId = "free" | "plus_5gb" | "pro_10gb" | "max_25gb";
export type StorageBillingInterval = "monthly" | "yearly" | "one_time";

const GB = 1024 * 1024 * 1024;

export const STORAGE_PLANS: Record<
  StoragePlanId,
  { label: string; quotaBytes: number; monthlyCents: number; yearlyCents: number }
> = {
  free: { label: "Free", quotaBytes: 2 * GB, monthlyCents: 0, yearlyCents: 0 },
  plus_5gb: { label: "Plus", quotaBytes: 5 * GB, monthlyCents: 300, yearlyCents: 3240 },
  pro_10gb: { label: "Pro", quotaBytes: 10 * GB, monthlyCents: 500, yearlyCents: 5400 },
  max_25gb: { label: "Max", quotaBytes: 25 * GB, monthlyCents: 1000, yearlyCents: 10800 },
};

export function planFromId(planId: string): StoragePlanId | null {
  if (planId in STORAGE_PLANS) return planId as StoragePlanId;
  return null;
}
