import { randomUUID } from "crypto";
import admin_setting from "../../model/default_admin_setting.schema";
import user from "../../model/user.schema";
import pricing_config from "../../model/pricing_config.schema";
import {
  CA_PROVINCE_TAX_RATES,
  DEFAULT_PRICING_CONFIG,
  defaultPaymentMethodHint,
  PaymentMethodFee,
  PricingConfigDoc,
  PricingProductType,
  PricingRegion,
  ProductFeeOverride,
  RegionPricingConfig,
  resolveRegionFromCountry,
  US_STATE_TAX_RATES,
} from "../../config/pricing";

export type BillingAddress = {
  country?: string;
  state?: string;
  postal_code?: string;
  city?: string;
  line1?: string;
};

export type QuoteLineItem = {
  key: string;
  label: string;
  amountMinor: number;
};

export type QuoteParams = {
  region?: PricingRegion;
  productType: PricingProductType;
  sessionSubtotalCents: number;
  trainerId?: string;
  paymentMethodHint?: string;
  billingAddress?: BillingAddress;
  promoDiscountCents?: number;
  userId?: string;
};

export type QuoteResult = {
  quoteId: string;
  pricingConfigVersion: number;
  region: PricingRegion;
  currency: "USD" | "CAD";
  productType: PricingProductType;
  sessionSubtotalCents: number;
  promoDiscountCents: number;
  discountedSubtotalCents: number;
  traineePlatformFeeCents: number;
  trainerPlatformFeeCents: number;
  processingFeeCents: number;
  taxCents: number;
  chargeTotalCents: number;
  platformFeePercentCents: number;
  commissionRate: number;
  trainerNetCents: number;
  platformNetMarginCents: number;
  paymentMethodHint: string;
  taxRate: number;
  taxLabel: string;
  breakdown: QuoteLineItem[];
  expiresAt: string;
};

const quoteCache = new Map<string, QuoteResult>();
const CACHE_TTL_MS = 30 * 60 * 1000;

let cachedConfig: PricingConfigDoc | null = null;
let cachedConfigVersion = 0;

function normalizeCommissionRate(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  if (n > 1) return Math.min(n / 100, 1);
  return n;
}

function docToConfig(doc: any): PricingConfigDoc {
  const regions = doc.regions || {};
  const toRegion = (r: any, fallback: RegionPricingConfig): RegionPricingConfig => {
    const pmFees: Record<string, PaymentMethodFee> = { ...fallback.paymentMethodFees };
    if (r?.paymentMethodFees) {
      const src = r.paymentMethodFees instanceof Map ? Object.fromEntries(r.paymentMethodFees) : r.paymentMethodFees;
      Object.assign(pmFees, src);
    }
    return {
      currency: r?.currency || fallback.currency,
      traineePlatformFeeMinor: r?.traineePlatformFeeMinor ?? fallback.traineePlatformFeeMinor,
      trainerPlatformFeeMinor: r?.trainerPlatformFeeMinor ?? fallback.trainerPlatformFeeMinor,
      defaultCommissionRate: r?.defaultCommissionRate ?? fallback.defaultCommissionRate,
      minCommissionRateFloor: r?.minCommissionRateFloor ?? fallback.minCommissionRateFloor,
      passProcessingFeeToTrainee: r?.passProcessingFeeToTrainee ?? fallback.passProcessingFeeToTrainee,
      paymentMethodFees: pmFees,
      storagePlans: r?.storagePlans || fallback.storagePlans,
      stripeTaxEnabled: r?.stripeTaxEnabled ?? fallback.stripeTaxEnabled,
      cogsMinor: r?.cogsMinor || fallback.cogsMinor,
    };
  };
  return {
    version: doc.version ?? 1,
    effectiveAt: doc.effective_at || doc.effectiveAt || new Date(),
    quoteToleranceMinor: doc.quote_tolerance_minor ?? doc.quoteToleranceMinor ?? 5,
    regions: {
      US: toRegion(regions.US, DEFAULT_PRICING_CONFIG.regions.US),
      CA: toRegion(regions.CA, DEFAULT_PRICING_CONFIG.regions.CA),
    },
    productFees: { ...DEFAULT_PRICING_CONFIG.productFees, ...(doc.product_fees || doc.productFees || {}) },
  };
}

export async function seedPricingConfigIfEmpty(): Promise<void> {
  const count = await pricing_config.countDocuments();
  if (count > 0) return;
  await pricing_config.create({
    version: DEFAULT_PRICING_CONFIG.version,
    is_active: true,
    effective_at: new Date(),
    quote_tolerance_minor: DEFAULT_PRICING_CONFIG.quoteToleranceMinor,
    regions: DEFAULT_PRICING_CONFIG.regions,
    product_fees: DEFAULT_PRICING_CONFIG.productFees,
  });
}

export async function getActivePricingConfig(force = false): Promise<PricingConfigDoc> {
  if (cachedConfig && !force) return cachedConfig;
  await seedPricingConfigIfEmpty();
  const doc = await pricing_config.findOne({ is_active: true }).sort({ version: -1 }).lean();
  if (!doc) {
    cachedConfig = DEFAULT_PRICING_CONFIG;
    cachedConfigVersion = 1;
    return cachedConfig;
  }
  cachedConfig = docToConfig(doc);
  cachedConfigVersion = cachedConfig.version;
  return cachedConfig;
}

export function invalidatePricingConfigCache() {
  cachedConfig = null;
}

export async function resolveCommissionRate(
  trainerId: string | undefined,
  region: PricingRegion,
  configOverride?: PricingConfigDoc
): Promise<number> {
  const config = configOverride || (await getActivePricingConfig());
  const fallback = config.regions[region].defaultCommissionRate;

  if (trainerId) {
    const trainer = await user.findById(trainerId).select("commission").lean();
    if (trainer?.commission != null && Number(trainer.commission) >= 0) {
      return normalizeCommissionRate(trainer.commission, fallback);
    }
  }

  const adminDoc = await admin_setting.findOne().lean();
  if (adminDoc?.commission != null) {
    return normalizeCommissionRate(adminDoc.commission, fallback);
  }

  return fallback;
}

function getProductFees(
  config: PricingConfigDoc,
  productType: PricingProductType,
  regionCfg: RegionPricingConfig
): ProductFeeOverride {
  const override = config.productFees[productType];
  return {
    traineePlatformFeeMinor:
      override?.traineePlatformFeeMinor ?? regionCfg.traineePlatformFeeMinor,
    trainerPlatformFeeMinor:
      override?.trainerPlatformFeeMinor ?? regionCfg.trainerPlatformFeeMinor,
  };
}

function resolvePaymentMethodFee(
  regionCfg: RegionPricingConfig,
  hint?: string,
  region?: PricingRegion
): { key: string; fee: PaymentMethodFee } {
  const key = hint || defaultPaymentMethodHint(region || "US");
  const fee = regionCfg.paymentMethodFees[key];
  if (fee) return { key, fee };
  const domestic = defaultPaymentMethodHint(region || "US");
  return { key: domestic, fee: regionCfg.paymentMethodFees[domestic] };
}

function estimateTaxRate(region: PricingRegion, billingAddress?: BillingAddress): { rate: number; label: string } {
  if (region === "US") {
    const state = String(billingAddress?.state || "").toUpperCase();
    const rate = US_STATE_TAX_RATES[state] ?? US_STATE_TAX_RATES.DEFAULT;
    return { rate, label: state ? `Sales tax (${state})` : "Estimated sales tax" };
  }
  const prov = String(billingAddress?.state || "").toUpperCase();
  const rate = CA_PROVINCE_TAX_RATES[prov] ?? CA_PROVINCE_TAX_RATES.DEFAULT;
  const label =
    prov === "ON" || prov === "NS" || prov === "NB" || prov === "NL" || prov === "PE"
      ? `HST (${prov})`
      : prov === "QC"
        ? `GST/QST (${prov})`
        : prov
          ? `Tax (${prov})`
          : "Estimated tax";
  return { rate, label };
}

function computeProcessingFeeMinor(chargeBaseMinor: number, fee: PaymentMethodFee): number {
  return Math.round(chargeBaseMinor * (fee.bps / 10000)) + fee.fixedMinor;
}

export async function buildQuote(params: QuoteParams): Promise<QuoteResult> {
  const config = await getActivePricingConfig();
  return computeQuoteFromConfig(config, params, { cache: true });
}

export async function buildQuoteWithConfig(
  configInput: PricingConfigDoc,
  params: QuoteParams
): Promise<QuoteResult> {
  const config =
    configInput?.regions?.US?.paymentMethodFees != null
      ? configInput
      : docToConfig(configInput);
  return computeQuoteFromConfig(config, params, { cache: false });
}

async function computeQuoteFromConfig(
  config: PricingConfigDoc,
  params: QuoteParams,
  options: { cache?: boolean } = {}
): Promise<QuoteResult> {
  const region: PricingRegion =
    params.region || resolveRegionFromCountry(params.billingAddress?.country);
  const regionCfg = config.regions[region];
  const productType = params.productType || "session_booking";

  const promoDiscountCents = Math.max(0, Math.round(params.promoDiscountCents || 0));
  const sessionSubtotalCents = Math.max(0, Math.round(params.sessionSubtotalCents || 0));
  const discountedSubtotalCents = Math.max(0, sessionSubtotalCents - promoDiscountCents);

  const productFee = getProductFees(config, productType, regionCfg);
  const traineePlatformFeeCents = productFee.traineePlatformFeeMinor;
  const trainerPlatformFeeCents = productFee.trainerPlatformFeeMinor;

  const commissionRate = await resolveCommissionRate(params.trainerId, region, config);
  const platformFeePercentCents = Math.round(discountedSubtotalCents * commissionRate);
  const trainerNetCents = Math.max(
    0,
    discountedSubtotalCents - platformFeePercentCents - trainerPlatformFeeCents
  );

  const chargeBaseMinor = discountedSubtotalCents + traineePlatformFeeCents;
  const { key: paymentMethodHint, fee: pmFee } = resolvePaymentMethodFee(
    regionCfg,
    params.paymentMethodHint,
    region
  );

  const processingFeeCents = regionCfg.passProcessingFeeToTrainee
    ? computeProcessingFeeMinor(chargeBaseMinor, pmFee)
    : 0;

  const { rate: taxRate, label: taxLabel } = estimateTaxRate(region, params.billingAddress);
  const taxableMinor = chargeBaseMinor + processingFeeCents;
  const taxCents = Math.round(taxableMinor * taxRate);

  const chargeTotalCents = chargeBaseMinor + processingFeeCents + taxCents;

  const cogsMinor = regionCfg.cogsMinor.liveSessionPerHour;
  const platformNetMarginCents =
    platformFeePercentCents +
    traineePlatformFeeCents +
    trainerPlatformFeeCents -
    processingFeeCents -
    cogsMinor;

  const breakdown: QuoteLineItem[] = [
    { key: "session_subtotal", label: "Session price", amountMinor: discountedSubtotalCents },
  ];
  if (promoDiscountCents > 0) {
    breakdown.push({ key: "promo_discount", label: "Promo discount", amountMinor: -promoDiscountCents });
  }
  if (traineePlatformFeeCents > 0) {
    breakdown.push({
      key: "trainee_platform_fee",
      label: "Platform fee",
      amountMinor: traineePlatformFeeCents,
    });
  }
  if (processingFeeCents > 0) {
    breakdown.push({
      key: "processing_fee",
      label: "Processing fee",
      amountMinor: processingFeeCents,
    });
  }
  if (taxCents > 0) {
    breakdown.push({ key: "tax", label: taxLabel, amountMinor: taxCents });
  }
  breakdown.push({ key: "total", label: "Total", amountMinor: chargeTotalCents });

  const quote: QuoteResult = {
    quoteId: randomUUID(),
    pricingConfigVersion: config.version,
    region,
    currency: regionCfg.currency,
    productType,
    sessionSubtotalCents,
    promoDiscountCents,
    discountedSubtotalCents,
    traineePlatformFeeCents,
    trainerPlatformFeeCents,
    processingFeeCents,
    taxCents,
    chargeTotalCents,
    platformFeePercentCents,
    commissionRate,
    trainerNetCents,
    platformNetMarginCents,
    paymentMethodHint,
    taxRate,
    taxLabel,
    breakdown,
    expiresAt: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
  };

  if (options.cache !== false) {
    quoteCache.set(quote.quoteId, quote);
  }
  return quote;
}

export async function validateQuoteForPayment(params: {
  quoteId?: string;
  sessionSubtotalCents?: number;
}): Promise<QuoteResult | null> {
  if (!params.quoteId) return null;
  const quote = getCachedQuote(params.quoteId);
  if (!quote) {
    throw new Error("Quote expired or not found. Please refresh checkout.");
  }
  const config = await getActivePricingConfig();
  const tolerance = config.quoteToleranceMinor ?? 5;
  if (
    params.sessionSubtotalCents != null &&
    Math.abs(quote.discountedSubtotalCents - params.sessionSubtotalCents) > tolerance
  ) {
    throw new Error("Quote no longer matches session price. Please refresh checkout.");
  }
  return quote;
}

export function getCachedQuote(quoteId: string): QuoteResult | null {
  const q = quoteCache.get(quoteId);
  if (!q) return null;
  if (new Date(q.expiresAt).getTime() < Date.now()) {
    quoteCache.delete(quoteId);
    return null;
  }
  return q;
}

export function quoteToEscrowMetadata(quote: QuoteResult, extra: Record<string, string> = {}) {
  return {
    quote_id: quote.quoteId,
    pricing_config_version: String(quote.pricingConfigVersion),
    region: quote.region,
    currency: quote.currency,
    session_subtotal_cents: String(quote.discountedSubtotalCents),
    trainee_platform_fee_cents: String(quote.traineePlatformFeeCents),
    trainer_platform_fee_cents: String(quote.trainerPlatformFeeCents),
    processing_fee_cents: String(quote.processingFeeCents),
    tax_cents: String(quote.taxCents),
    platform_fee_percent_cents: String(quote.platformFeePercentCents),
    commission_rate: String(quote.commissionRate),
    trainer_net_cents: String(quote.trainerNetCents),
    charge_total_cents: String(quote.chargeTotalCents),
    ...extra,
  };
}

export function parseQuoteFromMetadata(meta: Record<string, string | undefined>) {
  if (!meta?.session_subtotal_cents) return null;
  const discountedSubtotalCents = Number(meta.session_subtotal_cents);
  const platformFeePercentCents = Number(meta.platform_fee_percent_cents || 0);
  const trainerPlatformFeeCents = Number(meta.trainer_platform_fee_cents || 0);
  const trainerNetCents =
    Number(meta.trainer_net_cents) ||
    Math.max(0, discountedSubtotalCents - platformFeePercentCents - trainerPlatformFeeCents);
  return {
    sessionSubtotalCents: discountedSubtotalCents,
    traineePlatformFeeCents: Number(meta.trainee_platform_fee_cents || 0),
    trainerPlatformFeeCents,
    processingFeeCents: Number(meta.processing_fee_cents || 0),
    taxCents: Number(meta.tax_cents || 0),
    platformFeePercentCents,
    commissionRate: Number(meta.commission_rate || 0.15),
    trainerNetCents,
    chargeTotalCents: Number(meta.charge_total_cents || 0),
    region: (meta.region as PricingRegion) || "US",
    currency: meta.currency || "USD",
  };
}

export async function savePricingConfig(
  payload: Partial<PricingConfigDoc>,
  adminId: string
): Promise<PricingConfigDoc> {
  const current = await getActivePricingConfig(true);
  const nextVersion = (current.version || 0) + 1;
  await pricing_config.updateMany({ is_active: true }, { is_active: false });
  const doc = await pricing_config.create({
    version: nextVersion,
    is_active: true,
    effective_at: payload.effectiveAt || new Date(),
    quote_tolerance_minor: payload.quoteToleranceMinor ?? current.quoteToleranceMinor,
    regions: payload.regions || current.regions,
    product_fees: payload.productFees || current.productFees,
    updated_by_admin_id: adminId,
  });
  invalidatePricingConfigCache();
  return docToConfig(doc.toObject());
}

export async function listPricingConfigHistory(limit = 10) {
  return pricing_config.find().sort({ version: -1 }).limit(limit).lean();
}

export class PricingService {
  getActiveConfig = getActivePricingConfig;
  quote = buildQuote;
  getQuote = getCachedQuote;
  resolveCommission = resolveCommissionRate;
  saveConfig = savePricingConfig;
  listHistory = listPricingConfigHistory;
}

export const pricingService = new PricingService();
