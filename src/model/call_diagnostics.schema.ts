import { Schema, model as Model } from "mongoose";
import { Tables } from "../config/tables";

const callDiagnosticsSchema: Schema = new Schema(
  {
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: "booked_sessions",
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    accountType: {
      type: String,
      enum: ["Trainer", "Trainee"],
      required: true,
    },
    role: {
      type: String,
      enum: ["trainer", "trainee"],
    },
    // Type of diagnostic event
    eventType: {
      type: String,
      enum: ["CLIENT_CALL_DIAGNOSTICS", "CLIENT_PRECALL_CHECK", "CALL_QUALITY_STATS"],
      required: true,
    },
    // Environment info (from CLIENT_CALL_DIAGNOSTICS)
    env: {
      userAgent: String,
      platform: String,
      language: String,
      hasRTCPeerConnection: Boolean,
      hasGetUserMedia: Boolean,
      connectionType: String,
      downlink: Number,
      rtt: Number,
    },
    // Pre-call check result (from CLIENT_PRECALL_CHECK)
    preflightCheck: {
      passed: Boolean,
      reason: String, // NO_CAMERA, NO_MICROPHONE, NO_RTCPeerConnection, etc.
    },
    // Quality stats (from CALL_QUALITY_STATS)
    qualityStats: {
      overallScore: Number,
      audioScore: Number,
      videoScore: Number,
      rtt: Number,
      usingRelay: Boolean,
      audio: {
        inbound: {
          packetsReceived: Number,
          packetsLost: Number,
          bytesReceived: Number,
          jitter: Number,
        },
        outbound: {
          packetsSent: Number,
          bytesSent: Number,
        },
      },
      video: {
        inbound: {
          packetsReceived: Number,
          packetsLost: Number,
          bytesReceived: Number,
          framesReceived: Number,
          framesDropped: Number,
          frameWidth: Number,
          frameHeight: Number,
        },
        outbound: {
          packetsSent: Number,
          bytesSent: Number,
          framesSent: Number,
          frameWidth: Number,
          frameHeight: Number,
        },
      },
      connection: {
        rtt: Number,
        availableOutgoingBitrate: Number,
        availableIncomingBitrate: Number,
        localCandidateType: String,
        remoteCandidateType: String,
      },
    },
  },
  { timestamps: true }
);

// Indexes for faster queries
callDiagnosticsSchema.index({ sessionId: 1, createdAt: -1 });
callDiagnosticsSchema.index({ userId: 1, createdAt: -1 });
callDiagnosticsSchema.index({ eventType: 1, createdAt: -1 });

const CallDiagnostics = Model("call_diagnostics", callDiagnosticsSchema);
export default CallDiagnostics;

