import * as bcrypt from "bcrypt";

export class Bcrypt {
  public getHashedPassword = async (password: string): Promise<string> => {
    const salt = await bcrypt.genSalt();
    return await bcrypt.hash(password, salt);
  };

  public comparePassword = async (loggedInPass: string, dbPass: string) => {
    return await bcrypt.compare(loggedInPass, dbPass);
  };
}
