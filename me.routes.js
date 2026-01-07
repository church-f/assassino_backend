const express = require("express");
const { requireAuth } = require("./authMiddleware");
const { db, ensureUserDoc } = require("./firestore");
const ColorEnum = require("./Enums/colorEnum");

const router = express.Router();

function convertValueToEnums(data) {
  if (data.personalizzazioni && typeof data.personalizzazioni.colore === 'number') {
    const colorIndex = data.personalizzazioni.colore;
    data.personalizzazioni.colore = {int: ColorEnum[colorIndex] || 'unknown', value: colorIndex};
  }
}



router.get("/me", requireAuth, async (req, res) => {
  const uid = req.user.uid;

  // sicurezza: se per qualche motivo manca, lo ricrei
  await ensureUserDoc(uid);

  const snap = await db().collection("users").doc(uid).get();
  let data = snap.data() || {};

  convertValueToEnums(data);

  if(!data.plus){
    data.statistiche = {
      ...data.statistiche,
      vittorie: "***",
      sconfitte: "***",
      sbirro: "***",
      rianimatrice: "***",
      assassino: "***"
        };
  }

  res.json({
    uid,
    ...data
  });
});

module.exports = router;
