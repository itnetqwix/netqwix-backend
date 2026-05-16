import { IsEmail, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { model } from "../../../model";

export class googleLoginModel extends model {
  @IsEmail()
  @IsNotEmpty()
  public email: string;

  @IsOptional()
  @IsString()
  public id_token?: string;

  constructor(body: any) {
    super();
    const { email, id_token } = body;
    this.email = email;
    this.id_token = id_token;
  }
}
