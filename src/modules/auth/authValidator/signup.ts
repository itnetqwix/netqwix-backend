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
    } = body;
    this.fullname = fullname;
    this.email = email;
    this.password = password;
    this.mobile_no = mobile_no;
    this.account_type = account_type;
    this.category = category;
    this.isGoogleRegister = isGoogleRegister;
  }
}
