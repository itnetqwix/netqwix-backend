import { IsEmail, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { model } from "../../../model";

export class appleLoginModel extends model {
  @IsOptional()
  @IsEmail()
  public email?: string;

  @IsNotEmpty()
  @IsString()
  public identity_token: string;

  constructor(body: any) {
    super();
    const { email, identity_token } = body;
    this.email = email;
    this.identity_token = identity_token;
  }
}
