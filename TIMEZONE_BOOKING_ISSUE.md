# Timezone Booking Issue Analysis

## Problem
A booking made from EST timezone to a trainer in IST (Asia/Calcutta) is not showing up on the trainer's side.

## Booking Data
```json
{
  "_id": "699847232479410cd266a941",
  "status": "confirmed",
  "booked_date": "2026-02-20T17:05:58.926Z",
  "start_time": "2026-02-20T17:05:00.000Z",
  "end_time": "2026-02-20T17:20:00.000Z",
  "time_zone": "Asia/Calcutta"
}
```

## Root Cause Analysis

### 1. Backend Filtering (`userService.ts` line 437-677)
- For "upcoming" status, backend filters: `end_time > now` (UTC comparison)
- Also applies `dateFilter`: `booked_date >= twoDaysAgo`
- The booking should pass these filters since dates are in the future

### 2. Frontend Filtering (`common.api.js` line 50-65)
- Frontend also filters upcoming sessions: `new Date(rawEndTime) > now`
- This happens BEFORE timezone conversion
- Should work correctly since it uses raw UTC times

### 3. Timezone Conversion (`utils.js` line 1039-1081)
- `convertTimesForDataArray` converts times based on `item.time_zone`
- Converts `start_time`, `end_time`, `booked_date` to local timezone
- This is correct - times should be displayed in viewer's local timezone

## Potential Issues

1. **Backend Date Filter**: The `dateFilter` uses `twoDaysAgo` calculated in server timezone, but `booked_date` is in UTC. This could cause mismatches.

2. **Status Mapping**: Backend maps "confirmed" to `BOOKED_SESSIONS_STATUS.confirm`, but need to verify this matches the database value.

3. **Missing Bookings**: If trainer is viewing a specific tab (e.g., "upcoming"), and the booking doesn't match the filter criteria, it won't show.

## Solution

### Backend Fix Needed:
1. Ensure `dateFilter` comparison uses UTC consistently
2. Verify status mapping matches database values
3. Add logging to debug why bookings aren't returned

### Frontend Fix Needed:
1. Ensure timezone conversion doesn't affect filtering logic
2. Display times in trainer's local timezone correctly
3. Show bookings regardless of timezone differences

## How Cross-Timezone Bookings Should Work

1. **Booking Creation**:
   - Trainee selects time in their timezone (EST)
   - System converts to UTC for storage (`start_time`, `end_time`)
   - Stores trainer's timezone (`time_zone: "Asia/Calcutta"`)

2. **Display for Trainer**:
   - Fetch booking with UTC times
   - Convert UTC times to trainer's local timezone (IST) for display
   - Show times in IST format

3. **Display for Trainee**:
   - Fetch booking with UTC times
   - Convert UTC times to trainee's local timezone (EST) for display
   - Show times in EST format

## Recommended Fixes

### Backend (`userService.ts`)
```typescript
// Ensure dateFilter uses UTC consistently
const twoDaysAgo = new Date();
twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2);
twoDaysAgo.setUTCHours(0, 0, 0, 0);
```

### Frontend (`common.api.js`)
- Remove duplicate filtering if backend already filters correctly
- Or ensure frontend filter uses UTC times before conversion

### Verification Steps
1. Check backend logs to see if booking is returned from database
2. Check if booking passes backend filters
3. Check if booking passes frontend filters
4. Verify timezone conversion is working correctly
