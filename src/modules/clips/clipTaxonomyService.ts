import mongoose from "mongoose";
import clip_category from "../../model/clip_category.schema";
import clip_subcategory from "../../model/clip_subcategory.schema";
import { ensureClipTaxonomySeeded } from "./clipTaxonomySeed";

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export class ClipTaxonomyService {
  async getPublicTaxonomy() {
    await ensureClipTaxonomySeeded();
    const categories = await clip_category
      .find({ is_active: true })
      .sort({ sort_order: 1, name: 1 })
      .lean();
    const categoryIds = categories.map((c) => c._id);
    const subcategories = await clip_subcategory
      .find({ category_id: { $in: categoryIds }, is_active: true })
      .sort({ sort_order: 1, name: 1 })
      .lean();

    const subsByCat = new Map<string, typeof subcategories>();
    for (const s of subcategories) {
      const key = String(s.category_id);
      if (!subsByCat.has(key)) subsByCat.set(key, []);
      subsByCat.get(key)!.push(s);
    }

    return {
      categories: categories.map((c) => ({
        id: String(c._id),
        name: c.name,
        slug: c.slug,
        subcategories: (subsByCat.get(String(c._id)) || []).map((s) => ({
          id: String(s._id),
          name: s.name,
          slug: s.slug,
          categoryId: String(s.category_id),
        })),
      })),
    };
  }

  async listCategoriesAdmin() {
    await ensureClipTaxonomySeeded();
    const categories = await clip_category.find().sort({ sort_order: 1, name: 1 }).lean();
    const subs = await clip_subcategory.find().sort({ sort_order: 1, name: 1 }).lean();
    const subsByCat = new Map<string, typeof subs>();
    for (const s of subs) {
      const key = String(s.category_id);
      if (!subsByCat.has(key)) subsByCat.set(key, []);
      subsByCat.get(key)!.push(s);
    }
    return categories.map((c) => ({
      ...c,
      id: String(c._id),
      subcategories: (subsByCat.get(String(c._id)) || []).map((s) => ({
        ...s,
        id: String(s._id),
        category_id: String(s.category_id),
      })),
    }));
  }

  async createCategory(name: string, adminId: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Category name is required");
    const slug = slugify(trimmed) || `cat-${Date.now()}`;
    const maxOrder = await clip_category.findOne().sort({ sort_order: -1 }).select("sort_order").lean();
    const doc = await clip_category.create({
      name: trimmed,
      slug,
      sort_order: (maxOrder?.sort_order ?? 0) + 1,
      is_active: true,
      created_by_admin: adminId,
    });
    return doc;
  }

  async updateCategory(id: string, body: { name?: string; is_active?: boolean; sort_order?: number }) {
    const update: Record<string, unknown> = {};
    if (body.name != null) {
      const trimmed = String(body.name).trim();
      if (!trimmed) throw new Error("Category name is required");
      update.name = trimmed;
      update.slug = slugify(trimmed);
    }
    if (body.is_active != null) update.is_active = Boolean(body.is_active);
    if (body.sort_order != null) update.sort_order = Number(body.sort_order);
    return clip_category.findByIdAndUpdate(id, { $set: update }, { new: true });
  }

  async deleteCategory(id: string) {
    const subCount = await clip_subcategory.countDocuments({ category_id: id });
    if (subCount > 0) throw new Error("Remove subcategories before deleting this category");
    return clip_category.findByIdAndDelete(id);
  }

  async createSubcategory(categoryId: string, name: string, adminId: string) {
    if (!mongoose.Types.ObjectId.isValid(categoryId)) throw new Error("Invalid category");
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Subcategory name is required");
    const cat = await clip_category.findById(categoryId);
    if (!cat) throw new Error("Category not found");
    const slug = slugify(trimmed) || `sub-${Date.now()}`;
    const maxOrder = await clip_subcategory
      .findOne({ category_id: categoryId })
      .sort({ sort_order: -1 })
      .select("sort_order")
      .lean();
    return clip_subcategory.create({
      category_id: categoryId,
      name: trimmed,
      slug,
      sort_order: (maxOrder?.sort_order ?? 0) + 1,
      is_active: true,
      created_by_admin: adminId,
    });
  }

  async updateSubcategory(
    id: string,
    body: { name?: string; is_active?: boolean; sort_order?: number; category_id?: string }
  ) {
    const update: Record<string, unknown> = {};
    if (body.name != null) {
      const trimmed = String(body.name).trim();
      if (!trimmed) throw new Error("Subcategory name is required");
      update.name = trimmed;
      update.slug = slugify(trimmed);
    }
    if (body.is_active != null) update.is_active = Boolean(body.is_active);
    if (body.sort_order != null) update.sort_order = Number(body.sort_order);
    if (body.category_id != null) update.category_id = body.category_id;
    return clip_subcategory.findByIdAndUpdate(id, { $set: update }, { new: true });
  }

  async deleteSubcategory(id: string) {
    return clip_subcategory.findByIdAndDelete(id);
  }

  async resolveCategoryIds(
    categoryId: string | undefined,
    subcategoryId: string | undefined
  ): Promise<{ categoryId: mongoose.Types.ObjectId; subcategoryId: mongoose.Types.ObjectId; categoryName: string; subcategoryName: string }> {
    if (!categoryId || !subcategoryId) {
      throw new Error("category_id and subcategory_id are required");
    }
    if (!mongoose.Types.ObjectId.isValid(categoryId) || !mongoose.Types.ObjectId.isValid(subcategoryId)) {
      throw new Error("Invalid category or subcategory id");
    }
    const [cat, sub] = await Promise.all([
      clip_category.findOne({ _id: categoryId, is_active: true }).lean(),
      clip_subcategory.findOne({ _id: subcategoryId, is_active: true }).lean(),
    ]);
    if (!cat) throw new Error("Category not found or inactive");
    if (!sub) throw new Error("Subcategory not found or inactive");
    if (String(sub.category_id) !== String(cat._id)) {
      throw new Error("Subcategory does not belong to the selected category");
    }
    return {
      categoryId: cat._id as mongoose.Types.ObjectId,
      subcategoryId: sub._id as mongoose.Types.ObjectId,
      categoryName: cat.name,
      subcategoryName: sub.name,
    };
  }

  async findCategoryIdByName(name: string): Promise<string | null> {
    await ensureClipTaxonomySeeded();
    const n = name.trim().toLowerCase();
    if (!n) return null;
    const cat = await clip_category.findOne({ name: new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"), is_active: true }).lean();
    return cat ? String(cat._id) : null;
  }
}

export const clipTaxonomyService = new ClipTaxonomyService();
