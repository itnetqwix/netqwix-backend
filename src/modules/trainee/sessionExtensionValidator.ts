import { model } from "../../model";
import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString } from "class-validator";
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

export class sessionExtensionRequestModal extends model {
  @IsNotEmpty()
  @IsString()
  public sessionId: string;

  @IsNotEmpty()
  @IsNumber()
  public minutes: number;

  constructor(body: Record<string, unknown>) {
    super();
    this.sessionId = String(body.sessionId ?? "");
    this.minutes = Number(body.minutes);
  }
}

export class sessionExtensionRespondModal extends model {
  @IsNotEmpty()
  @IsString()
  public sessionId: string;

  @IsNotEmpty()
  @IsString()
  public requestId: string;

  @IsNotEmpty()
  @IsIn(["accept", "reject"])
  public decision: "accept" | "reject";

  constructor(body: Record<string, unknown>) {
    super();
    this.sessionId = String(body.sessionId ?? "");
    this.requestId = String(body.requestId ?? "");
    this.decision = (body.decision as "accept" | "reject") ?? "reject";
  }
}

export class sessionExtensionCancelModal extends model {
  @IsNotEmpty()
  @IsString()
  public sessionId: string;

  @IsNotEmpty()
  @IsString()
  public requestId: string;

  @IsOptional()
  @IsString()
  public reason?: string;

  constructor(body: Record<string, unknown>) {
    super();
    this.sessionId = String(body.sessionId ?? "");
    this.requestId = String(body.requestId ?? "");
    this.reason = body.reason as string | undefined;
  }
}

export class sessionExtensionPaymentIntentModal extends model {
  @IsNotEmpty()
  @IsString()
  public sessionId: string;

  @IsNotEmpty()
  @IsNumber()
  public minutes: number;

  /** Required once the trainer has accepted a request — guarantees the PI is
   *  tied to an approved request and prevents charging without consent. */
  @IsOptional()
  @IsString()
  public requestId?: string;

  @IsOptional()
  @IsString()
  public couponCode?: string;

  constructor(body: Record<string, unknown>) {
    super();
    this.sessionId = String(body.sessionId ?? "");
    this.minutes = Number(body.minutes);
    this.requestId = body.requestId as string | undefined;
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
  public requestId?: string;

  @IsOptional()
  @IsString()
  public payment_intent_id?: string;

  @IsOptional()
  @IsString()
  public payment_method?: string;

  @IsOptional()
  @IsString()
  public pin_session_token?: string;

  constructor(body: Record<string, unknown>) {
    super();
    this.sessionId = String(body.sessionId ?? "");
    this.minutes = Number(body.minutes);
    this.requestId = body.requestId as string | undefined;
    this.payment_intent_id = body.payment_intent_id as string | undefined;
    this.payment_method = body.payment_method as string | undefined;
    this.pin_session_token = body.pin_session_token as string | undefined;
  }
}

export function isAllowedExtensionMinutes(minutes: number): boolean {
  return (SESSION_EXTENSION.BLOCK_MINUTES as readonly number[]).includes(minutes);
}
