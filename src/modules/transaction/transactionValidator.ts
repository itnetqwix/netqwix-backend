import { model } from "../../model";

import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from "class-validator";

export class createPaymentIntent extends model {
  @IsNotEmpty()
  @IsNumber()
  public amount: number;

  @IsOptional()
  @IsString()
  public couponCode: string;

  constructor(body) {
    super();
    const { amount,couponCode } = body;
    this.amount = amount;
    this.couponCode = couponCode;
  }
}
