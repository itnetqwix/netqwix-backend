import { BOOKED_SESSIONS_STATUS } from "../../config/constance";
import { model } from "../../model";
import * as l10n from "jm-ez-l10n";

import {
  IsNotEmpty,
  IsString,
  IsEnum,
  IsDateString,
  Validate,
  IsObject,
  IsOptional,
  IsNumber,
  Min,
  Matches,
  IsIn,
} from "class-validator";
import { timeRegex } from "../../config/constance";
import { INSTANT_ALLOWED_DURATIONS } from "../../config/instantLesson";
import { IsUserTrainer } from "../user/userValidatorConstraints";
export class bookSessionModal extends model {
  // checking validation
  @IsNotEmpty()
  @IsString()
  public trainer_id: string;

  @IsNotEmpty()
  @IsString()
  @IsEnum(BOOKED_SESSIONS_STATUS)
  public status: string;

  @IsNotEmpty()
  @IsDateString()
  public booked_date: string;

  @IsNotEmpty()
  @IsString()
  @Matches(timeRegex, { message: "session_start_time must be HH:mm" })
  public session_start_time: string;

  @IsNotEmpty()
  @IsString()
  @Matches(timeRegex, { message: "session_end_time must be HH:mm" })
  public session_end_time: string;

  // initially it's going to be null
  @IsNotEmpty()
  @IsString()
  @IsOptional()
  public session_link: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  public charging_price: number;

  @IsNotEmpty()
  @IsString()
  public time_zone: string;

  @IsOptional()
  @IsString()
  public coupon_code?: string;

  @IsOptional()
  @IsString()
  public payment_intent_id?: string;

  @IsOptional()
  @IsIn(["wallet", "card"])
  public payment_method?: string;

  @IsOptional()
  @IsString()
  public pin_session_token?: string;

  @IsOptional()
  @IsString()
  public quote_id?: string;

  public iceServers: any[]; 
  
  constructor(body) {
    super();
    const {
      trainer_id,
      status,
      booked_date,
      session_start_time,
      session_end_time,
      charging_price,
      iceServers,
      time_zone,
      coupon_code,
      payment_intent_id,
      payment_method,
      pin_session_token,
      quote_id,
    } = body;
    this.trainer_id = trainer_id;
    this.status = status;
    this.booked_date = booked_date;
    this.session_start_time = String(session_start_time ?? "");
    this.session_end_time = String(session_end_time ?? "");
    this.session_link = null;
    this.charging_price = charging_price;
    this.iceServers = iceServers || []; 
    this.time_zone = time_zone;
    this.coupon_code = coupon_code;
    this.payment_intent_id = payment_intent_id;
    this.payment_method = payment_method;
    this.pin_session_token = pin_session_token;
    this.quote_id = quote_id;
  }
}

export class bookInstantMeetingModal extends model {
  @Validate(IsUserTrainer, { message: l10n.t("NOT_A_TRAINER") })
  @IsNotEmpty()
  @IsString()
  public trainer_id: string;

  /** Optional. If omitted, server uses UTC "now" so instant lesson is timezone/schedule independent. */
  @IsOptional()
  @IsDateString()
  public booked_date?: Date;

  /** Lesson duration in minutes — instant allows 15 or 30 only. */
  @IsOptional()
  @IsNumber()
  @IsIn([...INSTANT_ALLOWED_DURATIONS])
  public duration?: number;

  /** Optional promo/coupon code. */
  @IsOptional()
  @IsString()
  public coupon_code?: string;

  @IsOptional()
  @IsString()
  public payment_intent_id?: string;

  @IsOptional()
  @IsIn(["wallet", "card"])
  public payment_method?: string;

  @IsOptional()
  @IsString()
  public pin_session_token?: string;

  @IsOptional()
  @IsString()
  public quote_id?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  public charging_price?: number;

  constructor(body) {
    super();
    const {
      trainer_id,
      booked_date,
      duration,
      coupon_code,
      payment_intent_id,
      payment_method,
      pin_session_token,
      charging_price,
      quote_id,
    } = body;
    this.trainer_id = trainer_id;
    this.booked_date = booked_date;
    this.duration =
      duration != null && duration !== "" ? Number(duration) : undefined;
    this.coupon_code = coupon_code;
    this.charging_price =
      charging_price != null && charging_price !== ""
        ? Number(charging_price)
        : undefined;
    this.payment_intent_id = payment_intent_id;
    this.payment_method = payment_method;
    this.pin_session_token = pin_session_token;
    this.quote_id = quote_id;
  }
}

export class cancelInstantLessonModal extends model {
  @IsNotEmpty()
  @IsString()
  public lessonId: string;

  constructor(body: Record<string, unknown>) {
    super();
    this.lessonId = String(body.lessonId ?? body.lesson_id ?? "");
  }
}

export class checkSlotExistModal extends model {
  @Validate(IsUserTrainer, { message: l10n.t("NOT_A_TRAINER") })
  @IsNotEmpty()
  @IsString()
  public trainer_id: string;

  @IsNotEmpty()
  @IsObject()
  public slotTime: object;

  @IsNotEmpty()
  @IsDateString()
  public booked_date: Date;

  @IsNotEmpty()
  @IsString()
  public traineeTimeZone: string;

  constructor(body) {
    super();
    const { trainer_id, slotTime, booked_date, traineeTimeZone } = body;
    this.slotTime = slotTime;
    this.trainer_id = trainer_id;
    this.booked_date = booked_date;
    this.traineeTimeZone = String(traineeTimeZone ?? "");
  }
}
