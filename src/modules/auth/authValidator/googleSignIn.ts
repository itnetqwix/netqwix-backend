import { IsEmail, IsNotEmpty } from "class-validator";
import { model } from "../../../model";

export class googleLoginModel extends model {
  @IsEmail()
  @IsNotEmpty()
  public email: string;


  constructor(body: any) {
    super();
    const { email } = body;

    this.email = email;
  }
}
