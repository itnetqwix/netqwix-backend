import { IsEmail, IsNotEmpty, IsString } from "class-validator";
import { model } from "../../../model";

export class loginModel extends model {
  @IsEmail()
  @IsNotEmpty()
  public email: string;

  @IsNotEmpty()
  @IsString()
  public password: string;

  constructor(body: any) {
    super();
    const { email, password } = body;

    this.email = email;
    this.password = password;
  }
}

export class forgotPasswordEmailModal extends model {
  @IsEmail()
  @IsNotEmpty()
  public email: string;

  constructor(body: any) {
    super();
    const { email } = body;

    this.email = email;
  }
}

export class confirmResetPasswordModal extends model {
  @IsString()
  @IsNotEmpty()
  public token: string;

  @IsString()
  @IsNotEmpty()
  public password: string;

  constructor(body: any) {
    super();
    const { token, password } = body;

    this.token = token;
    this.password = password;
  }
}
