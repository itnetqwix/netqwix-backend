# Call Diagnostics Guide

## Overview
Call diagnostics are now automatically collected and stored in the database for every video call session. This includes:
- **Environment diagnostics** (browser, device, WebRTC support)
- **Pre-call check results** (compatibility, permissions, device availability)
- **Connection quality stats** (packet loss, RTT, bitrate, relay usage)

---

## Where to Check Diagnostics

### 1. **Backend Console Logs** (Real-time)
All diagnostics are logged to the backend console with prefixes:
- `[CallDiagnostics]` - Environment info
- `[PreCallCheck]` - Pre-flight check results
- `[CallQuality]` - Quality metrics

**To view:** Check your backend server logs (terminal/console where Node.js is running)

---

### 2. **Database** (Persisted)
All diagnostics are stored in MongoDB collection: `call_diagnostics`

**To query directly:**
```javascript
// MongoDB shell or Compass
db.call_diagnostics.find({ sessionId: ObjectId("...") }).sort({ createdAt: -1 })
```

---

### 3. **Admin API Endpoints** (Recommended)

#### Get All Diagnostics (with filters)
```
GET /admin/call-diagnostics
```

**Query Parameters:**
- `sessionId` - Filter by session ID
- `userId` - Filter by user ID
- `eventType` - Filter by event type (`CLIENT_CALL_DIAGNOSTICS`, `CLIENT_PRECALL_CHECK`, `CALL_QUALITY_STATS`)
- `limit` - Number of results (default: 100)
- `skip` - Pagination offset (default: 0)

**Example:**
```
GET /admin/call-diagnostics?sessionId=507f1f77bcf86cd799439011&limit=50
```

**Response:**
```json
{
  "status": "SUCCESS",
  "data": {
    "diagnostics": [...],
    "total": 150,
    "limit": 50,
    "skip": 0
  }
}
```

---

#### Get Call Quality Summary for a Session
```
GET /admin/call-quality-summary/:sessionId
```

**Example:**
```
GET /admin/call-quality-summary/507f1f77bcf86cd799439011
```

**Response:**
```json
{
  "status": "SUCCESS",
  "data": {
    "sessionId": "507f1f77bcf86cd799439011",
    "summary": {
      "totalSamples": 45,
      "averageOverallScore": 87.5,
      "averageAudioScore": 92.3,
      "averageVideoScore": 82.7,
      "averageRtt": 125.5,
      "relayUsagePercentage": 15
    },
    "stats": [...]
  }
}
```

---

## What Data is Collected

### 1. CLIENT_CALL_DIAGNOSTICS
Collected once per session when call starts:
- Browser user agent
- Platform (OS)
- WebRTC support flags
- Network connection type (4G, WiFi, etc.)
- Network quality hints (downlink, RTT)

### 2. CLIENT_PRECALL_CHECK
Collected when pre-flight check runs:
- `passed`: boolean
- `reason`: Why check failed (e.g., `NO_CAMERA`, `NO_MICROPHONE`, `NO_RTCPeerConnection`, `PERMISSIONS_BLOCKED`)

### 3. CALL_QUALITY_STATS
Collected every 10 seconds during active calls (sampled ~20% to avoid DB overload):
- Overall quality score (0-100)
- Audio score (0-100)
- Video score (0-100)
- Round-trip time (RTT)
- Packet loss rates
- Bitrate (incoming/outgoing)
- Frame rates
- Whether TURN relay is being used

---

## Use Cases

### Debugging Failed Calls
```bash
# Find all pre-call failures for a session
GET /admin/call-diagnostics?sessionId=XXX&eventType=CLIENT_PRECALL_CHECK
```

### Analyzing Call Quality Issues
```bash
# Get quality summary
GET /admin/call-quality-summary/XXX
```

### Understanding Browser/Device Mix
```bash
# Get all environment diagnostics
GET /admin/call-diagnostics?eventType=CLIENT_CALL_DIAGNOSTICS
```

---

## Authentication
All admin endpoints require authentication. Make sure to include your auth token in the request headers.

---

## Notes
- Quality stats are sampled (~20%) to avoid database overload
- Diagnostics are automatically cleaned up based on your database retention policy
- All timestamps are in UTC

