import { PipelineStage } from "mongoose";
import { log } from "../../../logger";
import { Bcrypt } from "../../Utils/bcrypt";
import { isDataExists } from "../../common/types/mongoose.types";
import { ResponseBuilder } from "../../helpers/responseBuilder";
import { AccountType, LoginType } from "./authEnum";
import { loginModel } from "./authValidator/login";
import { signupModel } from "./authValidator/signup";
import * as l10n from "jm-ez-l10n";
import JWT from "../../Utils/jwt";
import { googleLoginModel } from "./authValidator/googleSignIn";
import user from "../../model/user.schema";
import { SendEmail } from "../../Utils/sendEmail";
import { CONSTANCE, NetquixImage } from "../../config/constance";
import { stripeHelperController } from "../stripe/stripeHelperController";
import admin_setting from "../../model/default_admin_setting.schema";
import ReferredUser from "../../model/referred.user.schema";
const stripe = require("stripe")(process.env.STRIPE_SECRET);


export class AuthService {
  public log = log.getLogger();
  public bcrypt = new Bcrypt();
  public JWT = new JWT();

  public createNewUser = async (
    createUser: signupModel
  ): Promise<ResponseBuilder> => {
    this.log.info(createUser);
    let hashPassword: string;
    let account: any;
    // Check if a referred user with this email exists
    const referredUser = await ReferredUser.findOne({ email: createUser.email });

    if (createUser.password) {
      hashPassword = await this.bcrypt.getHashedPassword(createUser.password);
    }

    if (createUser.account_type === AccountType.TRAINER) {
      account = await stripeHelperController.createAccount(createUser);
    } else if (createUser.account_type === AccountType.TRAINEE) {
      account = await stripeHelperController.createCustomer(createUser);
    }

    const global_commission = await admin_setting.findOne();

    let updateduserObj: {
      password: string;
      login_type: LoginType;
      is_registered_with_stript: boolean;
      stripe_account_id: any;
      commission: any;
      fullname: string;
      email: string;
      mobile_no: string;
      account_type: AccountType;
      category?: string;
      isGoogleRegister?: boolean;
      extraInfo?: {
        availabilityInfo: {
          availability: Record<string, { start: string; end: string }[]>;
          selectedDuration: number;
          timeZone: string;
        };
        hourly_rate: string
      };
    } = {
      ...createUser,
      password: createUser.password ? hashPassword : null,
      login_type: Boolean(createUser.isGoogleRegister)
        ? LoginType.GOOGLE
        : LoginType.DEFAULT,
      is_registered_with_stript: account?.id ? true : false,
      stripe_account_id: account?.id,
      commission: global_commission?.commission ?? 0,

    };

    if (createUser.account_type === AccountType.TRAINER) {
      updateduserObj = {
        ...updateduserObj,
        extraInfo: {
          availabilityInfo: {
            availability: {
              Sun: [{ start: "9:00 AM", end: "5:00 PM" }],
              Mon: [{ start: "9:00 AM", end: "5:00 PM" }],
              Tue: [{ start: "9:00 AM", end: "5:00 PM" }],
              Wed: [{ start: "9:00 AM", end: "5:00 PM" }],
              Thu: [{ start: "9:00 AM", end: "5:00 PM" }],
              Fri: [{ start: "9:00 AM", end: "5:00 PM" }],
              Sat: [{ start: "9:00 AM", end: "5:00 PM" }],
            },
            selectedDuration: 15,
            timeZone: "America/New_York",
          },
          hourly_rate: "20"
        },
      };
    }

    delete createUser.isGoogleRegister;

    // Create the user object, but replace its _id if referredUser exists
    const userObj = referredUser
      ? new user({ ...updateduserObj, _id: referredUser._id,friends:[referredUser.referrerId] }) // Use referred user's _id
      : new user(updateduserObj); // Create a new user normally


    await userObj.save();




    // Remove the referred user from the ReferredUser collection if it was created from there
    if (referredUser) {
      const rUser = await user.findById(referredUser.referrerId);
      rUser.friends = [referredUser._id];
      await rUser.save();
      await ReferredUser.deleteOne({ _id: referredUser._id });
    }

    // SendEmail.sendRawEmail(
    //   null,
    //   "",
    //   [createUser.email],
    //   "Welcome to NetQwix's Training Portal",
    //   null,
    //   `<div style="font-family: Verdana,Arial,Helvetica,sans-serif;font-size: 18px;line-height: 30px;">
    //     Welcome  <i  style='color:#aebf76'>${createUser.fullname}</i>
    //     <br/><br/>
    //     Thank you for joining NetQwix Training Team. We look forward to you using this platform
    //     to connect with new NetQwix Team Members.
    //     <br/><br/>
    //     Please <u style='color:#aebf76'><a href=${process.env.FRONTEND_URL}>click here</a></u> 
    //     to log in and set up your Trainer Profile and set your Schedule Availability.
    //     <br/><br/>
    //     Team NetQwix. 
    //     <br/>
    //     <img src=${NetquixImage.logo} style="object-fit: contain; width: 180px;"/>
    //     </div> `
    // );

    const emailTemplate =
      createUser.account_type === AccountType.TRAINER
        ? "trainer-welcome"
        : "trainee-welcome";

    SendEmail.sendRawEmail(
      emailTemplate,
      null,
      [createUser.email],
      "Welcome to NetQwix!",
      "Thank you for joining!"
    );
    const adminEmail = process.env.EMAIL_USER || "shubhamrakhecha5@gmail.com";

    if (createUser.account_type === AccountType.TRAINER) {
      SendEmail.sendRawEmail(
        "new-trainer",
        {
          "[TRAINER_NAME]": createUser.fullname,
          "[TRAINER_NAME2]": createUser.fullname,
          "[ADMIN_URL]": process.env.BASE_URL + "/user/approve-expert/" + userObj._id,
          "[EMAIL_AND_NUMBER]":`${createUser.email}, ${createUser.mobile_no}.`
        },
        [adminEmail],
        `NetQwix New Expert Sign Up Request from ${createUser.fullname}`,
      );
    } else {
      await user.findByIdAndUpdate(userObj._id, { status: "approved" },
        { new: true })
      SendEmail.sendRawEmail(
        "new-trainee",
        {
          "[TRAINER_NAME]": createUser.fullname,
          "[TRAINER_NAME2]": createUser.fullname,
           "[EMAIL_AND_NUMBER]":`${createUser.email}, ${createUser.mobile_no}.`
        },
        [adminEmail],
        `NetQwix New Enthusiast - ${createUser.fullname}`,
      );
    }


    return ResponseBuilder.data(userObj, l10n.t("USER_CREATED_SUCCESS"));
  };

  public getUser = async (newUser: loginModel) => {
    try {
      const { email } = newUser;
      if (!email) {
        return ResponseBuilder.badRequest("Email is required.");
      }
      return await user.findOne({ email }).select('+password');
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  };

  public login = async (user: loginModel): Promise<ResponseBuilder> => {
    try {
      const { email, password } = user;
      if (!email) {
        return ResponseBuilder.badRequest("Email is required.");
      }
      if (!password) {
        return ResponseBuilder.badRequest("Password is required.");
      }
      const userDetails: any = await this.getUser(user);
      if (userDetails) {
        const validPassword = await this.bcrypt.comparePassword(
          password,
          userDetails.password
        );
        if (validPassword) {
          const payload = {
            user_id: userDetails._id,
            account_type: userDetails.account_type,
          };
          const access_token = this.JWT.signJWT(payload);
          //TODO: Store access_token in DB
          return ResponseBuilder.data(
            { data: { access_token, account_type: userDetails.account_type } },
            l10n.t("LOGIN_SUCCESSFULL")
          );
        } else {
          return ResponseBuilder.badRequest(l10n.t("INVALID_CREDENTIAL"));
        }
      } else {
        return ResponseBuilder.badRequest(l10n.t("INVALID_CREDENTIAL"));
      }
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  };

  public isUserExists = async (newUser: signupModel): Promise<isDataExists> => {
    try {
      if (!newUser.email) {
        ResponseBuilder.badRequest("Email is required.");
      }
      this.log.info(newUser);
      return await user.exists({
        email: newUser.email,
      });
    } catch (error) {
      ResponseBuilder.error(error, l10n.t("ERR_INTERNAL_SERVER"));
    }
  };

  public forgotPasswordEmail = async (
    email,
    authUser
  ): Promise<ResponseBuilder> => {
    try {
      const userInfo = await user.findById(authUser["_id"]);
      if (!userInfo) {
        return ResponseBuilder.errorMessage("User not found.");
      }
      const token = this.JWT.signJWT({
        user_id: authUser["_id"],
        account_type: userInfo.account_type,
      });
      const url = `${process.env.FRONTEND_URL}/auth/verified-forget-password?token=${token}`;

      SendEmail.sendRawEmail(
        null,
        null,
        [email],
        "Change NetQwix Training Portal Password",
        null,
        `<div style="font-family: Verdana,Arial,Helvetica,sans-serif;font-size: 18px;line-height: 30px;">
      Hello <i  style='color:#ff0000'>${userInfo.fullname},</i>
      <br/>
      To proceed with the password reset, kindly <a href=${url}>click here.</a>
      <br/>
      NetQwix Security.
      <br/>
      <img src=${NetquixImage.logo} style="object-fit: contain; width: 180px;"/>
       </div> `
      );
      return ResponseBuilder.data({}, l10n.t("RESET_PASSWORD_MAIL_SEND"));
    } catch (err) {
      return ResponseBuilder.error(err, l10n.t("ERR_INTERNAL_SERVER"));
    }
  };

  public confirmForgetPassword = async (authUser): Promise<ResponseBuilder> => {
    try {
      const { password, token } = authUser;
      if (!password || !token) {
        return ResponseBuilder.badRequest(l10n.t("MISSING_PARAMETERS"));
      }
      const hashedPassword = await this.bcrypt.getHashedPassword(password);
      const decodedToken = await JWT.decodeAuthToken(token);
      if (!decodedToken || !decodedToken["user_id"]) {
        return ResponseBuilder.badRequest(l10n.t("NOT_VERIFIED_TOKEN"));
      }
      const updatedUser = await user.findOneAndUpdate(
        { _id: decodedToken["user_id"] },
        { $set: { password: hashedPassword } },
        { new: true }
      );
      if (!updatedUser) {
        return ResponseBuilder.error(l10n.t("USER_NOT_FOUND"));
      }
      return ResponseBuilder.data(
        { data: updatedUser },
        l10n.t("PASSWORD_RESET_SUCCESS")
      );
    } catch (err) {
      console.error("Error in confirmResetPassword:", err);
      if (err.code === CONSTANCE.RES_CODE.error.badRequest) {
        return ResponseBuilder.error(l10n.t("NOT_VERIFIED_TOKEN"));
      } else {
        console.error("Error in confirmResetPassword:", err);
        return ResponseBuilder.error(l10n.t("ERR_INTERNAL_SERVER"));
      }
    }
  };

  public isGoogleUserExists = async (googleUser: googleLoginModel) => {
    try {
      const { email } = googleUser;
      if (!email) {
        return ResponseBuilder.badRequest("Email is required.");
      }
      return await user.findOne({ email });
    } catch (error) {
      return ResponseBuilder.error(l10n.t("ERR_INTERNAL_SERVER"));
    }
  };

  public googleLogin = async (user): Promise<any> => {
    try {
      const payload = {
        user_id: user._id,
        account_type: user.account_type,
      };
      const access_token = this.JWT.signJWT(payload);
      //TODO: Store access_token in DB
      return ResponseBuilder.data(
        { data: { access_token, account_type: user.account_type } },
        l10n.t("LOGIN_SUCCESSFULL")
      );
    } catch (error) {
      return ResponseBuilder.error(l10n.t("ERR_INTERNAL_SERVER"));
    }
  };
}
