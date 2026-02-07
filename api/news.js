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

const db = admin.firestore();

export default async function handler(req, res) {
  if (req.query.clau !== 'pere') return res.status(401).send('No autoritzat');

  try {
    // Fem una consulta de recompte optimitzada
    const snapshot = await db.collection('cercavins')
      .where('do', '==', 'Vila Viniteca')
      .count()
      .get();

    const totalVilaViniteca = snapshot.data().count;

    // També mirem quants n'hi ha amb "Desconeguda" o "Pendent"
    const snapshotErrors = await db.collection('cercavins')
      .where('do', 'in', ['DO Desconeguda', 'Desconeguda', 'Pendent'])
      .count()
      .get();
      
    const totalErrorsIA = snapshotErrors.data().count;

    return res.status(200).json({
      total_vins_vila_viniteca: totalVilaViniteca,
      total_vins_per_reparar_ia: totalErrorsIA,
      suma_total_pendents: totalVilaViniteca + totalErrorsIA,
      missatge: "Aquesta és la feina que ens queda per davant!"
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
