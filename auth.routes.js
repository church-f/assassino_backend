const express = require("express");
const { initFirebaseAdmin } = require("./firebaseAdmin");
const { ensureUserDoc } = require("./firestore");
const { cookieOpts } = require("./cookies");
const { setCsrfCookie, requireCsrf } = require("./csrf");

const admin = initFirebaseAdmin();
const router = express.Router();

const COOKIE_NAME = process.env.COOKIE_NAME || "session";

router.get("/csrf", (req, res) => {
  const token = setCsrfCookie(req, res);
  res.json({ csrfToken: token });
});

router.post("/session", requireCsrf, async (req, res) => {
  const { idToken, displayName } = req.body || {};
  if (!idToken) return res.status(400).json({ error: "Missing idToken" });

  const expiresIn = 1000 * 60 * 60 * 24 * 14;

  try {
    // 1) verifica idToken e prendi uid
    const decodedId = await admin.auth().verifyIdToken(idToken);
    console.log("Decoded ID token:", decodedId);
    const uid = decodedId.uid;

    // 2) crea session cookie
    const sessionCookie = await admin.auth().createSessionCookie(idToken, { expiresIn });
    res.cookie(COOKIE_NAME, sessionCookie, {
      ...cookieOpts({ httpOnly: true }),
      maxAge: expiresIn
    });

    // 3) crea/inizializza doc utente (idempotente)
    let displayNameToUse = displayName;
    if (!displayNameToUse) {
      if (decodedId.name) {
        displayNameToUse = decodedId.name;
      }
      else if (decodedId.email) {
        displayNameToUse = decodedId.email.split("@")[0];
      }
    }
    await ensureUserDoc(uid, {
      email: decodedId.email || null,
      displayName: displayNameToUse,
      photoURL: decodedId.picture || null
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("createSessionCookie error:", err);
    return res.status(401).json({ error: "Invalid ID token" });
  }
});

router.post("/logout", requireCsrf, async (req, res) => {
  const sessionCookie = req.cookies?.[COOKIE_NAME];

  // cancella cookie
  res.clearCookie(COOKIE_NAME, { path: "/" });

  // opzionale: revoca tokens (logout “forte”)
  if (sessionCookie) {
    try {
      const decoded = await admin.auth().verifySessionCookie(sessionCookie, true);
      await admin.auth().revokeRefreshTokens(decoded.sub);
    } catch (_) { }
  }

  res.json({ ok: true });
});

module.exports = router;
