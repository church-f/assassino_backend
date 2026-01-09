const express = require("express");
const { requireAuth } = require("../authMiddleware");
const { db, ensureUserDoc } = require("../firestore");
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)

const router = express.Router();


router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
 
  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);

    const session = event.data.object;
    if (event.type === "checkout.session.completed") {
      const userId = session.metadata.userId; // ✅ Recuperiamo l'ID utente dai metadata
      console.log(`🔔 Sessione completata per l'utente ${userId}`);

      if (userId) {
        await db().collection("users").doc(userId).update({ plus: true });
    //     const userDoc = await db.collection("users").doc(userId).get();
    //     const personalizedWords = userDoc.personalizedWords;
    //     const currentTime = Date.now();
    //     userCache.set(userId, {
    //       hasPlus: true,
    //       lastFetched: currentTime,
    //       personalizedWords
    //     });
        console.log(`✔️ Utente ${userId} aggiornato a Plus`);
      }
    }else if(event.type === "customer.subscription.deleted"){
      const mail = session.metadata.email;
    }

    res.json({ received: true });
  } catch (err) {
    console.error("❌ Errore nel webhook:", err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});


router.post('/createSession', requireAuth, async (req, res) => {
    console.log(req.user)
    // const { userId, email } = req.body;
    const userId = req.user.uid
    const email = req.user.email
    try {
    const session = await stripe.checkout.sessions.create({
      // allow_promotion_codes: true,
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price: process.env.PRICE_ID,
          quantity: 1,
        },
      ],
      success_url: `${process.env.WEB_ORIGIN}/success`,
      cancel_url: `${process.env.WEB_ORIGIN}/`,
      metadata: { userId: userId, email: email },
    });

    res.json({ sessionId: session.id, sessionUrl: session.url });
  } catch (error) {
    console.error("Errore creazione checkout:", error);
    res.status(500).json({ error: "Errore nella creazione della sessione di pagamento" });
  }
})

module.exports = router;
