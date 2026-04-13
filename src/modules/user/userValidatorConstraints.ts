import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";
import { isValidMongoObjectId } from "../../helpers/mongoose";
import user from "../../model/user.schema";
import { AccountType } from "../auth/authEnum";

@ValidatorConstraint({ async: false })
export class IsUserTrainer implements ValidatorConstraintInterface {
  public async validate(trainer_id: string) {
    if (isValidMongoObjectId(trainer_id)) {
      const userCount = await user
        .findOne({
          _id: trainer_id,
          account_type: AccountType.TRAINER,
        })
        .countDocuments();
      return userCount ? true : false;
    } else {
      return false;
    }
  }
}
