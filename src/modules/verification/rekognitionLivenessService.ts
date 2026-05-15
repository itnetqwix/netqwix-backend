import * as AWS from "aws-sdk";
import * as crypto from "crypto";
import { VERIFICATION_CONFIG } from "../../config/verification";
import { s3, S3_BUCKET } from "../../Utils/s3Client";

const rekognition = new AWS.Rekognition({
  region: VERIFICATION_CONFIG.rekognitionRegion,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

export class RekognitionLivenessService {
  async createSession(userId: string) {
    if (VERIFICATION_CONFIG.mockLiveness) {
      const sessionId = `mock-${userId}-${Date.now()}`;
      return {
        sessionId,
        region: VERIFICATION_CONFIG.rekognitionRegion,
        mock: true,
      };
    }

    const bucket = VERIFICATION_CONFIG.verificationBucket || S3_BUCKET;
    if (!bucket) throw new Error("VERIFICATION_S3_BUCKET not configured");

    const params: AWS.Rekognition.CreateFaceLivenessSessionRequest = {
      Settings: {
        AuditImagesLimit: 4,
        OutputConfig: {
          S3Bucket: bucket,
          S3KeyPrefix: `verification/selfies/${userId}/`,
        },
      },
    };

    const result = await rekognition.createFaceLivenessSession(params).promise();
    return {
      sessionId: result.SessionId,
      region: VERIFICATION_CONFIG.rekognitionRegion,
      mock: false,
    };
  }

  async getSessionResults(sessionId: string, userId: string) {
    if (VERIFICATION_CONFIG.mockLiveness || sessionId.startsWith("mock-")) {
      const key = `verification/selfies/${userId}/mock-${Date.now()}.jpg`;
      return {
        status: "SUCCEEDED",
        confidence: 99,
        reference_image_s3_key: key,
        isLive: true,
      };
    }

    const result = await rekognition
      .getFaceLivenessSessionResults({ SessionId: sessionId })
      .promise();

    const status = result.Status || "FAILED";
    const confidence = result.Confidence ?? 0;
    const reference = result.ReferenceImage;
    let s3Key = "";

    if (reference?.S3Object) {
      s3Key = `${reference.S3Object.Name || ""}`;
      if (reference.S3Object.Bucket && reference.S3Object.Name) {
        s3Key = reference.S3Object.Name;
      }
    }

    const isLive =
      status === "SUCCEEDED" && confidence >= VERIFICATION_CONFIG.livenessConfidenceMin;

    return {
      status,
      confidence,
      reference_image_s3_key: s3Key,
      isLive,
    };
  }

  getPresignedUrl(key: string, expiresSec = 300): string | null {
    const bucket = VERIFICATION_CONFIG.verificationBucket || S3_BUCKET;
    if (!bucket || !key) return null;
    return s3.getSignedUrl("getObject", {
      Bucket: bucket,
      Key: key,
      Expires: expiresSec,
    });
  }
}

export const rekognitionLivenessService = new RekognitionLivenessService();
