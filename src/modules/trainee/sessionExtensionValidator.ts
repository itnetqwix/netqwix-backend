import { model } from "../../model";
import { IsNotEmpty, IsNumber, IsOptional, IsString } from "class-validator";
import { SESSION_EXTENSION } from "../../config/sessionExtension";

export class sessionExtensionQuoteQuery extends model {
  @IsNotEmpty()
  @IsString()
  public sessionId: string;

  @IsNotEmpty()
  @IsNumber()
  public minutes: number;

  constructor(query: Record<string, unknown>) {
    super();
    this.sessionId = String(query.sessionId ?? "");
    this.minutes = Number(query.minutes);
  }
}

export class sessionExtensionPaymentIntentModal extends model {
  @IsNotEmpty()
  @IsString()
  public sessionId: string;

  @IsNotEmpty()
  @IsNumber()
  public minutes: number;

  @IsOptional()
  @IsString()
  public couponCode?: string;

  constructor(body: Record<string, unknown>) {
    super();
    this.sessionId = String(body.sessionId ?? "");
    this.minutes = Number(body.minutes);
    this.couponCode = body.couponCode as string | undefined;
  }
}

export class sessionExtensionConfirmModal extends model {
  @IsNotEmpty()
  @IsString()
  public sessionId: string;

  @IsNotEmpty()
  @IsNumber()
  public minutes: number;

  @IsOptional()
  @IsString()
  public payment_intent_id?: string;

  constructor(body: Record<string, unknown>) {
    super();
    this.sessionId = String(body.sessionId ?? "");
    this.minutes = Number(body.minutes);
    this.payment_intent_id = body.payment_intent_id as string | undefined;
  }
}

export function isAllowedExtensionMinutes(minutes: number): boolean {
  return (SESSION_EXTENSION.BLOCK_MINUTES as readonly number[]).includes(minutes);
}
