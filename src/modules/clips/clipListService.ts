import mongoose from "mongoose";
import clip from "../../model/clip.schema";
import clip_category from "../../model/clip_category.schema";
import clip_subcategory from "../../model/clip_subcategory.schema";
import clip_library_submission from "../../model/clip_library_submission.schema";

const ACTIVE_CLIP = { $or: [{ status: true }, { status: { $exists: false } }] };

export type NestedCategoryGroup = {
  categoryId: string | null;
  categoryName: string;
  subcategories: {
    subcategoryId: string | null;
    subcategoryName: string;
    clips: Record<string, unknown>[];
  }[];
};

async function loadCategoryMaps() {
  const [categories, subcategories] = await Promise.all([
    clip_category.find({}).lean(),
    clip_subcategory.find({}).lean(),
  ]);
  const catMap = new Map(categories.map((c) => [String(c._id), c.name]));
  const subMap = new Map(subcategories.map((s) => [String(s._id), s.name]));
  return { catMap, subMap };
}

function nestClipsByTaxonomy(
  clips: Record<string, unknown>[],
  catMap: Map<string, string>,
  subMap: Map<string, string>
): NestedCategoryGroup[] {
  const byCat = new Map<string, Map<string, Record<string, unknown>[]>>();

  for (const c of clips) {
    const catId = c.category_id ? String(c.category_id) : "__uncategorized__";
    const subId = c.subcategory_id ? String(c.subcategory_id) : "__none__";
    if (!byCat.has(catId)) byCat.set(catId, new Map());
    const subMapInner = byCat.get(catId)!;
    if (!subMapInner.has(subId)) subMapInner.set(subId, []);
    subMapInner.get(subId)!.push(c);
  }

  const groups: NestedCategoryGroup[] = [];
  for (const [catId, subGroups] of byCat.entries()) {
    const categoryName =
      catId === "__uncategorized__"
        ? "Uncategorized"
        : catMap.get(catId) || String((clips.find((x) => String(x.category_id) === catId) as any)?.category || "Uncategorized");
    const subcategories: NestedCategoryGroup["subcategories"] = [];
    for (const [subId, subClips] of subGroups.entries()) {
      subcategories.push({
        subcategoryId: subId === "__none__" ? null : subId,
        subcategoryName:
          subId === "__none__" ? "General" : subMap.get(subId) || "General",
        clips: subClips,
      });
    }
    subcategories.sort((a, b) => a.subcategoryName.localeCompare(b.subcategoryName));
    groups.push({
      categoryId: catId === "__uncategorized__" ? null : catId,
      categoryName,
      subcategories,
    });
  }
  groups.sort((a, b) => a.categoryName.localeCompare(b.categoryName));
  return groups;
}

export class ClipListService {
  async getMyClipsGrouped(userId: string, traineeId?: string | null) {
    const ownerId = new mongoose.Types.ObjectId(traineeId ?? userId);
    const rawClips = await clip
      .find({
        user_id: ownerId,
        clip_scope: { $ne: "library" },
        $and: [
          ACTIVE_CLIP,
          {
            $or: [
              { shared_from_user_id: null },
              { shared_from_user_id: { $exists: false } },
            ],
          },
        ],
      })
      .sort({ createdAt: -1 })
      .lean();

    const clipIds = rawClips.map((c) => c._id);
    const submissions = await clip_library_submission
      .find({ source_clip_id: { $in: clipIds }, requester_user_id: ownerId })
      .sort({ createdAt: -1 })
      .lean();
    const latestByClip = new Map<string, (typeof submissions)[0]>();
    for (const s of submissions) {
      const key = String(s.source_clip_id);
      if (!latestByClip.has(key)) latestByClip.set(key, s);
    }

    const enriched = rawClips.map((c) => {
      const sub = latestByClip.get(String(c._id));
      return {
        ...c,
        librarySubmission: sub
          ? {
              id: String(sub._id),
              status: sub.status,
              rejection_reason: sub.rejection_reason,
              published_library_clip_id: sub.published_library_clip_id,
            }
          : null,
      };
    });

    const { catMap, subMap } = await loadCategoryMaps();
    return nestClipsByTaxonomy(enriched as Record<string, unknown>[], catMap, subMap);
  }

  async getSharedClipsGrouped(userId: string) {
    const uid = new mongoose.Types.ObjectId(userId);
    const clips = await clip.aggregate([
      {
        $match: {
          user_id: uid,
          shared_from_user_id: { $ne: null, $exists: true },
          clip_scope: { $ne: "library" },
          ...ACTIVE_CLIP,
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "shared_from_user_id",
          foreignField: "_id",
          as: "sharer",
          pipeline: [{ $project: { fullname: 1, profile_picture: 1 } }],
        },
      },
      { $unwind: { path: "$sharer", preserveNullAndEmptyArrays: true } },
      { $sort: { shared_at: -1, createdAt: -1 } },
      {
        $group: {
          _id: "$shared_from_user_id",
          sharerName: { $first: "$sharer.fullname" },
          sharer: { $first: "$sharer" },
          clips: { $push: "$$ROOT" },
        },
      },
      { $sort: { sharerName: 1 } },
    ]);

    return clips.map((g: any) => ({
      sharerId: g._id ? String(g._id) : null,
      sharerName: g.sharerName || "Unknown",
      sharer: g.sharer,
      clips: g.clips,
    }));
  }

  async getLibraryClipsGrouped() {
    const rawClips = await clip
      .find({
        clip_scope: "library",
        ...ACTIVE_CLIP,
      })
      .sort({ createdAt: -1 })
      .lean();

    const { catMap, subMap } = await loadCategoryMaps();
    return nestClipsByTaxonomy(rawClips as Record<string, unknown>[], catMap, subMap);
  }
}

export const clipListService = new ClipListService();
