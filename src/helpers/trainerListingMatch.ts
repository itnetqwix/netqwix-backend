import { AccountType } from "../modules/auth/authEnum";

/** Parse `categories` (comma-separated) or legacy `category` query param. */
export function parseTrainerCategoryFilterList(
  categories?: string,
  category?: string
): string[] {
  return String(categories || category || "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Trainers visible in trainee browse/booking lists:
 * approved + verification completed, or legacy approved trainers (pre–verification flow).
 */
export function mongoMatchTrainerVisibleToTrainees(): Record<string, unknown> {
  return {
    account_type: AccountType.TRAINER,
    status: "approved",
    $or: [
      { "trainer_verification.onboarding_step": "completed" },
      { trainer_verification: { $exists: false } },
      {
        "trainer_verification.onboarding_step": {
          $in: ["account_created", null],
        },
        "trainer_verification.submitted_for_review_at": { $exists: false },
      },
    ],
  };
}

/**
 * Match trainers whose `category` string or `categories` array includes any selected label.
 */
export function buildTrainerCategoryMongoFilter(
  categoryList: string[]
): Record<string, unknown> | null {
  if (!categoryList.length) return null;

  const clauses = categoryList
    .map((raw) => {
      const cat = raw.trim();
      if (!cat) return null;
      const escaped = escapeRegex(cat);
      const listPattern = `(^|[,•|]\\s*)${escaped}(\\s*[,•|]|$)`;
      return {
        $or: [
          { category: { $regex: `^${escaped}$`, $options: "i" } },
          { category: { $regex: listPattern, $options: "i" } },
          { categories: cat },
          {
            categories: {
              $elemMatch: { $regex: `^${escaped}$`, $options: "i" },
            },
          },
        ],
      };
    })
    .filter(Boolean) as Record<string, unknown>[];

  if (!clauses.length) return null;
  return { $or: clauses };
}

/** Combine visibility, optional search, and category filters for the trainer directory aggregate. */
export function buildTrainerDirectoryMatchStage(options: {
  searchOr?: Record<string, unknown>[];
  categoryList?: string[];
}): Record<string, unknown> {
  const and: Record<string, unknown>[] = [mongoMatchTrainerVisibleToTrainees()];
  if (options.searchOr?.length) {
    and.push({ $or: options.searchOr });
  }
  const categoryFilter = buildTrainerCategoryMongoFilter(
    options.categoryList ?? []
  );
  if (categoryFilter) and.push(categoryFilter);
  return and.length === 1 ? and[0] : { $and: and };
}
