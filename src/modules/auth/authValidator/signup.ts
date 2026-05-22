import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from "class-validator";

import { AccountType } from "../authEnum";
import { model } from "../../../model";

export class signupModel extends model {
  @IsNotEmpty()
  @IsString()
  public fullname: string;

  @IsEmail()
  @IsNotEmpty()
  public email: string;

  // @IsOptional()
  @IsString()
  @IsNotEmpty()
  public password: string;

  // @IsOptional()
  @IsString()
  @IsNotEmpty()
  public mobile_no: string;

  @IsNotEmpty()
  @IsEnum(AccountType)
  public account_type: AccountType;

  @IsNotEmpty()
  @IsString()
  @IsOptional()
  public category?: string;

  @IsNotEmpty()
  @IsBoolean()
  @IsOptional()
  public isGoogleRegister?: boolean;

  /** Must be `true` — user accepted Terms & Conditions and Privacy Policy at signup. */
  @IsBoolean()
  @IsNotEmpty()
  public accepted_terms_and_privacy: boolean;

  constructor(body: any) {
    super();
    const {
      fullname,
      email,
      mobile_no,
      password,
      account_type,
      category,
      isGoogleRegister,
      accepted_terms_and_privacy,
    } = body;
    this.fullname = fullname;
    this.email = email;
    this.password = password;
    this.mobile_no = mobile_no;
    this.account_type = account_type;
    this.category = category;
    this.isGoogleRegister = isGoogleRegister;
    this.accepted_terms_and_privacy = accepted_terms_and_privacy === true;
  }
}
