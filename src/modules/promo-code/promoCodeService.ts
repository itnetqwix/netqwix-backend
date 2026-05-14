import PromoCode from "../../model/promo_code.schema";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import { assertAdminUser } from "../admin/adminPermission";
import { CONSTANCE } from "../../config/constance";

export class PromoCodeService {
  /**
   * Calculate the discount for a given promo code and amount.
   */
  public calculateDiscount(
    promo: { discount_type: string; discount_value: number; max_discount_amount: number },
    amount: number
  ): number {
    if (promo.discount_type === "percentage") {
      const raw = amount * (promo.discount_value / 100);
      return promo.max_discount_amount > 0
        ? Math.min(raw, promo.max_discount_amount)
        : raw;
    }
    // fixed_amount
    return Math.min(promo.discount_value, amount);
  }

  /**
   * Full validation of a promo code against all criteria.
   * Returns { valid, promo, discount_amount, final_amount } or { valid: false, reason }.
   */
  public async validatePromoCode(
    code: string,
    userId: string,
    userType: string,
    bookingType?: string,
    amount?: number,
    userLocation?: string
  ): Promise<{
    valid: boolean;
    reason?: string;
    promo?: any;
    discount_amount?: number;
    final_amount?: number;
  }> {
    const promo = await PromoCode.findOne({
      code: code.toUpperCase().trim(),
    });

    if (!promo) return { valid: false, reason: "Promo code not found." };
    if (!promo.is_active) return { valid: false, reason: "This promo code is no longer active." };

    const now = new Date();
    if (now < new Date(promo.start_date))
      return { valid: false, reason: "This promo code is not yet active." };
    if (now > new Date(promo.end_date))
      return { valid: false, reason: "This promo code has expired." };

    if (promo.usage_limit > 0 && promo.usage_count >= promo.usage_limit)
      return { valid: false, reason: "This promo code has reached its usage limit." };

    if (promo.per_user_limit > 0) {
      const userUsageCount = promo.used_by.filter(
        (u: any) => String(u.user_id) === String(userId)
      ).length;
      if (userUsageCount >= promo.per_user_limit)
        return { valid: false, reason: "You have already used this promo code the maximum number of times." };
    }

    const types = promo.applicable_user_types as string[];
    if (types.length > 0 && !types.includes("All") && !types.includes(userType))
      return { valid: false, reason: "This promo code is not applicable to your account type." };

    const bTypes = promo.applicable_booking_types as string[];
    if (
      bookingType &&
      bTypes.length > 0 &&
      !bTypes.includes("all") &&
      !bTypes.includes(bookingType)
    )
      return { valid: false, reason: `This promo code is not applicable to ${bookingType} bookings.` };

    if (promo.applicable_locations.length > 0 && userLocation) {
      const locLower = userLocation.toLowerCase();
      const match = (promo.applicable_locations as string[]).some(
        (l) => l.toLowerCase() === locLower
      );
      if (!match)
        return { valid: false, reason: "This promo code is not available in your location." };
    }

    if (amount != null && promo.min_order_amount > 0 && amount < promo.min_order_amount)
      return {
        valid: false,
        reason: `Minimum order amount of $${promo.min_order_amount} required for this promo code.`,
      };

    const effectiveAmount = amount ?? 0;
    const discount_amount = Number(this.calculateDiscount(
      { discount_type: promo.discount_type, discount_value: promo.discount_value, max_discount_amount: promo.max_discount_amount },
      effectiveAmount
    ).toFixed(2));
    const final_amount = Number(Math.max(effectiveAmount - discount_amount, 0).toFixed(2));

    return {
      valid: true,
      promo,
      discount_amount,
      final_amount,
    };
  }

  /**
   * Record usage of a promo code after a successful booking.
   */
  public async applyPromoCode(
    code: string,
    userId: string,
    bookingId: string,
    discountApplied: number
  ): Promise<void> {
    await PromoCode.findOneAndUpdate(
      { code: code.toUpperCase().trim() },
      {
        $inc: { usage_count: 1 },
        $push: {
          used_by: {
            user_id: userId,
            used_at: new Date(),
            booking_id: bookingId,
            discount_applied: discountApplied,
          },
        },
      }
    );
  }

  /**
   * Get visible promos for a given user type / location.
   */
  public async getVisiblePromos(
    userType: string,
    userLocation?: string
  ): Promise<any[]> {
    const now = new Date();
    const query: any = {
      is_active: true,
      is_visible: true,
      start_date: { $lte: now },
      end_date: { $gte: now },
    };

    const promos = await PromoCode.find(query)
      .select(
        "code display_label description discount_type discount_value min_order_amount max_discount_amount end_date applicable_user_types applicable_booking_types applicable_locations"
      )
      .sort({ createdAt: -1 })
      .lean();

    return promos.filter((p: any) => {
      const types = p.applicable_user_types as string[];
      if (types.length > 0 && !types.includes("All") && !types.includes(userType))
        return false;

      if (p.applicable_locations.length > 0 && userLocation) {
        const locLower = userLocation.toLowerCase();
        if (!(p.applicable_locations as string[]).some((l) => l.toLowerCase() === locLower))
          return false;
      }

      return true;
    });
  }

  // ─── Admin CRUD ────────────────────────────────────────────────

  public async createPromoCode(
    body: any,
    authUser: any
  ): Promise<ResponseBuilder> {
    const adminErr = assertAdminUser(authUser);
    if (adminErr) return ResponseBuilder.badRequest(adminErr, 403);

    const existing = await PromoCode.findOne({
      code: body.code.toUpperCase().trim(),
    });
    if (existing)
      return ResponseBuilder.badRequest("A promo code with this code already exists.");

    if (
      body.discount_type === "percentage" &&
      (body.discount_value < 0 || body.discount_value > 100)
    )
      return ResponseBuilder.badRequest("Percentage discount must be between 0 and 100.");

    const promo = new PromoCode({
      ...body,
      code: body.code.toUpperCase().trim(),
      created_by: authUser._id,
    });
    const saved = await promo.save();

    return ResponseBuilder.data(saved.toObject(), "Promo code created successfully.");
  }

  public async listPromoCodes(
    authUser: any,
    query: any
  ): Promise<ResponseBuilder> {
    const adminErr = assertAdminUser(authUser);
    if (adminErr) return ResponseBuilder.badRequest(adminErr, 403);

    const {
      search = "",
      page = 1,
      limit = 25,
      is_active,
      is_visible,
    } = query;

    const filter: any = {};
    if (search) {
      filter.$or = [
        { code: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { display_label: { $regex: search, $options: "i" } },
      ];
    }
    if (is_active === "true") filter.is_active = true;
    else if (is_active === "false") filter.is_active = false;
    if (is_visible === "true") filter.is_visible = true;
    else if (is_visible === "false") filter.is_visible = false;

    const skip = (Number(page) - 1) * Number(limit);
    const [promos, total] = await Promise.all([
      PromoCode.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate("created_by", "fullname email")
        .lean(),
      PromoCode.countDocuments(filter),
    ]);

    const data: any = {
      promos,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)),
    };
    return ResponseBuilder.data(data, "Promo codes fetched.");
  }

  public async getPromoCodeById(
    authUser: any,
    id: string
  ): Promise<ResponseBuilder> {
    const adminErr = assertAdminUser(authUser);
    if (adminErr) return ResponseBuilder.badRequest(adminErr, 403);

    const promo = await PromoCode.findById(id)
      .populate("created_by", "fullname email")
      .populate("used_by.user_id", "fullname email")
      .lean();
    if (!promo) return ResponseBuilder.badRequest("Promo code not found.", 404);

    return ResponseBuilder.data(promo, "Promo code details.");
  }

  public async updatePromoCode(
    authUser: any,
    id: string,
    body: any
  ): Promise<ResponseBuilder> {
    const adminErr = assertAdminUser(authUser);
    if (adminErr) return ResponseBuilder.badRequest(adminErr, 403);

    if (body.code) body.code = body.code.toUpperCase().trim();

    if (
      body.discount_type === "percentage" &&
      body.discount_value != null &&
      (body.discount_value < 0 || body.discount_value > 100)
    )
      return ResponseBuilder.badRequest("Percentage discount must be between 0 and 100.");

    const updated = await PromoCode.findByIdAndUpdate(id, { $set: body }, { new: true }).lean();
    if (!updated) return ResponseBuilder.badRequest("Promo code not found.", 404);

    return ResponseBuilder.data(updated, "Promo code updated successfully.");
  }

  public async deletePromoCode(
    authUser: any,
    id: string
  ): Promise<ResponseBuilder> {
    const adminErr = assertAdminUser(authUser);
    if (adminErr) return ResponseBuilder.badRequest(adminErr, 403);

    const deleted = await PromoCode.findByIdAndDelete(id);
    if (!deleted) return ResponseBuilder.badRequest("Promo code not found.", 404);

    const result: any = { deleted: true };
    return ResponseBuilder.data(result, "Promo code deleted.");
  }

  public async togglePromoCode(
    authUser: any,
    id: string
  ): Promise<ResponseBuilder> {
    const adminErr = assertAdminUser(authUser);
    if (adminErr) return ResponseBuilder.badRequest(adminErr, 403);

    const promo = await PromoCode.findById(id);
    if (!promo) return ResponseBuilder.badRequest("Promo code not found.", 404);

    promo.is_active = !promo.is_active;
    await promo.save();

    const result = promo.toObject();
    return ResponseBuilder.data(result, `Promo code ${promo.is_active ? "activated" : "deactivated"}.`);
  }

  public async toggleVisibility(
    authUser: any,
    id: string
  ): Promise<ResponseBuilder> {
    const adminErr = assertAdminUser(authUser);
    if (adminErr) return ResponseBuilder.badRequest(adminErr, 403);

    const promo = await PromoCode.findById(id);
    if (!promo) return ResponseBuilder.badRequest("Promo code not found.", 404);

    promo.is_visible = !promo.is_visible;
    await promo.save();

    const result = promo.toObject();
    return ResponseBuilder.data(
      result,
      `Promo code is now ${promo.is_visible ? "visible" : "hidden"} to users.`
    );
  }
}
