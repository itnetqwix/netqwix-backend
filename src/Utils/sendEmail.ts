import * as dotenv from "dotenv";
import * as fs from "fs";
import { keys } from "lodash";
import * as path from "path";
const nodemailer = require("nodemailer");
dotenv.config();

// await SendEmail.sendRawEmail(
//     "meeting",
//     { "{NAME}": "Arjun", "{MEETING_URL}" :"https://google.com"  },
//     ["arjun6597@gmail.com"],
//     "Login",
//   );
export class SendEmail {
  public static sendRawEmail = (
    template: string = null,
    replaceData: any = null,
    emails: string[],
    subject: string,
    text: string = null,
    customHtml = null
  ) => {
    try {
      let html = "";
      if (customHtml) {
        html = customHtml;
      } else {
        const templatesDir = path.resolve(`${__dirname}/../`, "templates");
        const content = `${templatesDir}/${template}.html`;
        html = SendEmail.getHtmlContent(content, replaceData);
      }
      const mailOptions = {
        from: process.env.EMAIL_FROM,
        html,
        subject,
        text,
        to: emails,
      };

      const transportObj: any = {
        auth: {
          pass: process.env.EMAIL_PASSWORD,
          user: process.env.EMAIL_USERNAME,
        },
        host: process.env.EMAIL_HOST,
        port: +process.env.EMAIL_PORT,
      };
      const transporter = nodemailer.createTransport(transportObj);
      transporter.sendMail(mailOptions, (mailSendErr: any, info: any) => {
        console.log(`mailSendErr ---- `, mailSendErr);
        console.log(`info ---- `, info);
        if (!mailSendErr) {
          return `Message sent: ${info.response}`;
        } else {
          return `Error in sending email: ${mailSendErr}`;
        }
      });
    } catch (err) {
      console.log(
        `Getting Err while sending EMAIL ${JSON.stringify(
          err
        )}, template ${template}`
      );
      return `Getting Err while sending EMAIL ${JSON.stringify(
        err
      )}, template ${template}`;
    }
  };

  public static sendRawEmailAsync = (
    emails: string[],
    subject: string,
    html: string,
    text: string = null
  ): Promise<any> => {
    return new Promise((resolve, reject) => {
      try {
        const mailOptions = {
          from: process.env.EMAIL_FROM,
          html,
          subject,
          text,
          to: emails,
        };
        const transportObj: any = {
          auth: {
            pass: process.env.EMAIL_PASSWORD,
            user: process.env.EMAIL_USERNAME,
          },
          host: process.env.EMAIL_HOST,
          port: +process.env.EMAIL_PORT,
        };
        const transporter = nodemailer.createTransport(transportObj);
        transporter.sendMail(mailOptions, (err: any, info: any) => {
          if (err) {
            reject(err);
          } else {
            resolve(info);
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  };

  private static getHtmlContent = (filePath: string, replaceData: any) => {
    const data = fs.readFileSync(filePath);
    let html = data.toString();
    keys(replaceData).forEach((key) => {
      html = html.replace(key, replaceData[key]);
    });
    return html;
  };
}
