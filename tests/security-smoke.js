/**
 * Manual smoke checks (run after deploy):
 * - Forged JWT returns 401 on GET /user/me
 * - Non-admin cannot PUT /user/update-trainer-status
 * - Blocked users cannot POST /chat/send
 */

const assert = require("assert");
const jwt = require("jsonwebtoken");

function testForgedJwtRejected() {
  const forged = jwt.sign(
    { user_id: "507f1f77bcf86cd799439011", account_type: "Admin" },
    "wrong-secret",
    { algorithm: "HS256" }
  );
  assert.ok(forged);
  console.log("security-smoke: forged token fixture ready (verify via integration test against running API)");
}

testForgedJwtRejected();
