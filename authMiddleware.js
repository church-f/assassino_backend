const { initFirebaseAdmin } = require("./firebaseAdmin");
const admin = initFirebaseAdmin();

const COOKIE_NAME = process.env.COOKIE_NAME || "session";

async function requireAuth(req, res, next) {
  const sessionCookie = req.cookies?.[COOKIE_NAME];
  if (!sessionCookie) return res.status(401).json({ error: "Not authenticated" });

  try {
    // checkRevoked=true: se fai revokeRefreshTokens invalida le sessioni
    const decoded = await admin.auth().verifySessionCookie(sessionCookie, true);
    req.user = { uid: decoded.sub, claims: decoded };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Not authenticated" });
  }
}

module.exports = { requireAuth };
