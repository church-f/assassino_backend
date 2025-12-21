const express = require("express");
const { requireAuth } = require("./authMiddleware");
const { db, ensureUserDoc } = require("./firestore");

const router = express.Router();

router.get("/me", requireAuth, async (req, res) => {
  const uid = req.user.uid;

  // sicurezza: se per qualche motivo manca, lo ricrei
  await ensureUserDoc(uid);

  const snap = await db().collection("users").doc(uid).get();
  const data = snap.data() || {};

  res.json({
    uid,
    ...data
  });
});

module.exports = router;
