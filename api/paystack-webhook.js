const crypto = require('crypto');
const admin = require('firebase-admin');

// Initialize Firebase Admin (We will add the credentials in the next step)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
  });
}

const db = admin.firestore();

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    try {
      // 1. Verify the signature (Security check)
      const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
                         .update(JSON.stringify(req.body))
                         .digest('hex');

      if (hash !== req.headers['x-paystack-signature']) {
        return res.status(401).send('Invalid Signature');
      }

      const event = req.body;

      // 2. Check if the event is a successful charge
      if (event.event === 'charge.success') {
        const { reference, amount, metadata } = event.data;
        const userUid = metadata.custom_fields[0].value; // We get the User ID from metadata
        const amountInNaira = amount / 100;

        const userRef = db.collection('users').doc(userUid);
        const depositRef = db.collection('deposits').doc(reference);

        // 3. Update Firestore using a Transaction (Prevent double funding)
        await db.runTransaction(async (t) => {
          const depositDoc = await t.get(depositRef);
          if (!depositDoc.exists) {
            t.set(depositRef, {
              uid: userUid,
              amount: amountInNaira,
              reference: reference,
              status: "success",
              timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
            t.update(userRef, {
              balance: admin.firestore.FieldValue.increment(amountInNaira)
            });
          }
        });
      }

      res.status(200).send('Webhook Received');
    } catch (error) {
      console.error('Webhook Error:', error);
      res.status(500).send('Internal Server Error');
    }
  } else {
    res.status(405).send('Method Not Allowed');
  }
};

