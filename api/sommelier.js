const admin = require('firebase-admin');

module.exports = async (req, res) => {
  try {
    const rawKey = process.env.FIREBASE_SERVICE_ACCOUNT || "";
    
    // Sabrem la veritat d'una vegada
    if (!rawKey.includes("private_key")) {
      return res.status(200).json({ 
        resposta: `DEBUG: Vercel encara no té el JSON. El que llegeix comença per: "${rawKey.substring(0, 15)}..."` 
      });
    }

    if (!admin.apps.length) {
      const serviceAccount = JSON.parse(rawKey.replace(/\\n/g, '\n'));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }

    const db = admin.firestore();
    const snapshot = await db.collection('cercavins').limit(1).get();
    
    if (snapshot.empty) {
      return res.status(200).json({ resposta: "Connexió OK, però el celler buit." });
    }

    const primerVi = snapshot.docs[0].data().nom;
    res.status(200).json({ resposta: `🔥 ÈXIT! Firebase connectat. He trobat: ${primerVi}` });

  } catch (error) {
    res.status(200).json({ resposta: "Error de lectura real: " + error.message });
  }
};
