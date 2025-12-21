    const { initFirebaseAdmin } = require("./firebaseAdmin");
const admin = initFirebaseAdmin();

function db() {
  return admin.firestore();
}

async function ensureUserDoc(uid, seed = {}) {
  const ref = db().collection("users").doc(uid);
  const snap = await ref.get();

  if (!snap.exists) {
    await ref.set({
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      plus: false,
      statistiche: { partite: 0, vittorie: 0, sconfitte: 0, assassino: 0 },
      personalizzazioni: {entrata: 0, avatar: 0, font: 0, colore: 0},
      ...seed
    });
  } else {
    // opzionale: assicurati che campi nuovi vengano aggiunti senza rompere utenti esistenti
    await ref.set(
      {
        lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
        ...seed
      },
      { merge: true }
    );
  }
}

module.exports = { db, ensureUserDoc };
