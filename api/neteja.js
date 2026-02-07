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
    // 1. Comptem el total de vins al celler
    const totalSnapshot = await db.collection('cercavins').count().get();
    const totalVins = totalSnapshot.data().count;

    // 2. BUSQUEM NOMÉS ELS QUE TENEN EL PREU COM A TEXT
    // En demanar que el preu sigui >= '', Firestore selecciona només els tipus "String"
    const snapshot = await db.collection('cercavins')
      .where('preu', '>=', '') 
      .limit(100)
      .get();

    if (snapshot.empty) {
      return res.status(200).json({ 
        missatge: "🏁 Felicitats! Ja no queden preus per convertir.",
        total_vins: totalVins 
      });
    }

    const batch = db.batch();
    let preusModificats = 0;

    snapshot.forEach(doc => {
      const data = doc.data();
      if (typeof data.preu === 'string') {
        // Netegem el text per convertir-lo en número (15,50 € -> 15.5)
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
      missatge: "🚀 Lot processat correctament",
      total_vins_al_celler: totalVins,
      preus_convertits_ara: preusModificats,
      pendents_estimats: "Continua refrescant fins que el comptador arribi a 0."
    });

  } catch (error) {
    // Si surt un error d'índex, Firebase et donarà un link, hauràs de clicar-lo un cop
    return res.status(500).json({ error: error.message });
  }
}
