import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsArray,
  IsEnum,
  IsDateString,
  Min,
  Max,
} from "class-validator";
import { model } from "../../model";

export class CreatePromoCodeDto extends model {
  @IsNotEmpty()
  @IsString()
  public code: string;

  @IsOptional()
  @IsString()
  public description: string;

  @IsNotEmpty()
  @IsEnum(["percentage", "fixed_amount"])
  public discount_type: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  public discount_value: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  public min_order_amount: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  public max_discount_amount: number;

  @IsNotEmpty()
  @IsDateString()
  public start_date: string;

  @IsNotEmpty()
  @IsDateString()
  public end_date: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  public usage_limit: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  public per_user_limit: number;

  @IsOptional()
  @IsArray()
  public applicable_user_types: string[];

  @IsOptional()
  @IsArray()
  public applicable_booking_types: string[];

  @IsOptional()
  @IsArray()
  public applicable_locations: string[];

  @IsOptional()
  @IsBoolean()
  public is_active: boolean;

  @IsOptional()
  @IsBoolean()
  public is_visible: boolean;

  @IsOptional()
  @IsString()
  public display_label: string;
}

export class UpdatePromoCodeDto extends model {
  @IsOptional()
  @IsString()
  public description: string;

  @IsOptional()
  @IsEnum(["percentage", "fixed_amount"])
  public discount_type: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  public discount_value: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  public min_order_amount: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  public max_discount_amount: number;

  @IsOptional()
  @IsDateString()
  public start_date: string;

  @IsOptional()
  @IsDateString()
  public end_date: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  public usage_limit: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  public per_user_limit: number;

  @IsOptional()
  @IsArray()
  public applicable_user_types: string[];

  @IsOptional()
  @IsArray()
  public applicable_booking_types: string[];

  @IsOptional()
  @IsArray()
  public applicable_locations: string[];

  @IsOptional()
  @IsBoolean()
  public is_active: boolean;

  @IsOptional()
  @IsBoolean()
  public is_visible: boolean;

  @IsOptional()
  @IsString()
  public display_label: string;
}

export class ValidatePromoDto extends model {
  @IsNotEmpty()
  @IsString()
  public code: string;

  @IsOptional()
  @IsString()
  public booking_type: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  public amount: number;
}
