const express = require("express");
const ColorEnum = require("../Enums/colorEnum");
const AvatarEnum = require("../Enums/avatarEnum");
const EntranceEnum = require("../Enums/EntranceEnum");
const { requireAuth } = require("../authMiddleware");
const { db, ensureUserDoc } = require("../firestore");

const router = express.Router();


router.get("/Enums", async (req, res) => {
    res.json({
        colors: ColorEnum,
        avatars: AvatarEnum,
        entrances: EntranceEnum
    });
});

router.put('/changeDisplayName', requireAuth, async (req, res) => {
    const uid = req.user.uid;
    const { displayName } = req.body;
    if (typeof displayName !== 'string' || displayName.length < 1 || displayName.length > 20) {
        return res.status(400).json({ error: "Display name must be a string between 1 and 20 characters." });
    }
    await ensureUserDoc(uid);
    await db().collection("users").doc(uid).set({ displayName }, { merge: true });
    res.json({ ok: true });
});

router.put('/changePersonalization', requireAuth, async (req, res) => {
    const uid = req.user.uid;
    const { colore, avatar, entrata, font } = req.body;
    
    await ensureUserDoc(uid);
    await db().collection("users").doc(uid).set({personalizzazioni: {colore, avatar, entrata, font} }, { merge: true });
    res.json({ ok: true });
});

module.exports = router;
