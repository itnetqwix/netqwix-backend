import * as AWS from "aws-sdk";

export const S3_BUCKET = process.env.AWS_BUCKET_NAME;

export const s3 = new AWS.S3({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  signatureVersion: "v4",
});
