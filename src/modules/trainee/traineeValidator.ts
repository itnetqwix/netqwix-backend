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
  isDate,
} from "class-validator";
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
  public session_start_time: number;

  @IsNotEmpty()
  @IsString()
  public session_end_time: number;

  // initially it's going to be null
  @IsNotEmpty()
  @IsString()
  @IsOptional()
  public session_link: string;

  @IsNotEmpty()
  @IsNumber()
  public charging_price: number;

  @IsNotEmpty()
  @IsString()
  public time_zone: string;

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
      time_zone
    } = body;
    this.trainer_id = trainer_id;
    this.status = status;
    this.booked_date = booked_date;
    this.session_start_time = session_start_time;
    this.session_end_time = session_end_time;
    this.session_link = null;
    this.charging_price = charging_price;
    this.iceServers = iceServers || []; 
    this.time_zone = time_zone
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

  /** Lesson duration in minutes (e.g. 15, 30, 60, 120). Default 30. */
  @IsOptional()
  @IsNumber()
  public duration?: number;

  /** Optional promo/coupon code. */
  @IsOptional()
  @IsString()
  public coupon_code?: string;

  constructor(body) {
    super();
    const { trainer_id, booked_date, duration, coupon_code } = body;
    this.trainer_id = trainer_id;
    this.booked_date = booked_date;
    this.duration = duration;
    this.coupon_code = coupon_code;
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

  constructor(body) {
    super();
    const { trainer_id, slotTime, booked_date } = body;
    this.slotTime = slotTime;
    this.trainer_id = trainer_id;
    this.booked_date = booked_date;
  }
}
