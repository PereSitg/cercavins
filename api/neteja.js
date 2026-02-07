import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID || "cercavins-10b76",
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL || "firebase-adminsdk-fbsvc@cercavins-10b76.iam.gserviceaccount.com",
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore(); // Definició de la base de dades
const GROQ_KEY = process.env.GROQ_API_KEY;

export default async function handler(req, res) {
  if (req.query.clau !== 'pere') return res.status(401).send('No autoritzat');

  try {
    // 1. Mirem quants vins tenim en TOTAL per saber la magnitud
    const totalSnapshot = await db.collection('cercavins').count().get();
    const totalVins = totalSnapshot.data().count;

    // 2. Agafem 100 vins per processar
    const snapshot = await db.collection('cercavins').limit(100).get();

    const batch = db.batch();
    let preusModificats = 0;

    snapshot.forEach(doc => {
      const data = doc.data();
      // Si el preu encara és un text, el convertim
      if (typeof data.preu === 'string') {
        let preuNet = data.preu.replace('€', '').replace(/\s/g, '').replace(',', '.').trim();
        const preuNumeric = parseFloat(preuNet);
        if (!isNaN(preuNumeric)) {
          batch.update(doc.ref, { preu: preuNumeric });
          preusModificats++;
        }
      }
    });

    await batch.commit();

    return res.status(200).json({
      missatge: "🚀 Lot processat",
      total_vins_al_celler: totalVins,
      preus_convertits_en_aquest_clic: preusModificats,
      nota: preusModificats === 0 ? "Aquest lot ja estava net, segueix fent refresc!" : "N'has netejat 100 més!"
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
