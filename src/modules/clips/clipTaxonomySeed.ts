import master_data from "../../model/master_data";
import clip_category from "../../model/clip_category.schema";
import clip from "../../model/clip.schema";

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Seed clip categories from master_data and backfill clip.category_id when empty. */
export async function ensureClipTaxonomySeeded(): Promise<void> {
  const count = await clip_category.countDocuments();
  if (count === 0) {
    const master = await master_data.findOne().lean();
    const names: string[] = Array.isArray(master?.category) ? master.category : ["Golf", "Tennis"];
    for (let i = 0; i < names.length; i++) {
      const name = String(names[i] || "").trim();
      if (!name) continue;
      const slug = slugify(name) || `category-${i}`;
      await clip_category.findOneAndUpdate(
        { slug },
        { $setOnInsert: { name, slug, sort_order: i, is_active: true } },
        { upsert: true, new: true }
      );
    }
  }

  const categories = await clip_category.find({ is_active: true }).lean();
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
  const orphans = await clip.find({
    $or: [{ category_id: null }, { category_id: { $exists: false } }],
    category: { $exists: true, $nin: [null, ""] },
    clip_scope: { $ne: "library" },
  }).limit(5000);

  for (const c of orphans) {
    const catName = String((c as any).category || "").trim();
    if (!catName) continue;
    const match = byName.get(catName.toLowerCase());
    if (match) {
      await clip.updateOne({ _id: c._id }, { $set: { category_id: match._id } });
    }
  }
}
