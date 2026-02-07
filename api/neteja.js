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
    const totalSnapshot = await db.collection('cercavins').count().get();
    const totalVins = totalSnapshot.data().count;

    // Busquem 100 vins on el preu NO sigui un número
    // Agafem una mostra per veure què hi ha realment
    const snapshot = await db.collection('cercavins').limit(100).get();

    const batch = db.batch();
    let preusModificats = 0;
    let mostresErrors = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      
      // Si el preu és un String O si és un camp buit o indefinit
      if (typeof data.preu !== 'number') {
        let preuOriginal = data.preu ? String(data.preu) : "";
        
        // Netegem a fons
        let preuNet = preuOriginal
          .replace('€', '')
          .replace(/[^\d,.]/g, '') // Treiem tot el que no sigui número, coma o punt
          .replace(',', '.')
          .trim();

        const preuNumeric = parseFloat(preuNet);

        if (!isNaN(preuNumeric)) {
          batch.update(doc.ref, { preu: preuNumeric });
          preusModificats++;
        } else {
          // Si tot i així no podem, guardem la mostra per saber què és
          mostresErrors.push({ id: doc.id, valor_original: preuOriginal });
        }
      }
    });

    if (preusModificats > 0) {
      await batch.commit();
    }

    return res.status(200).json({
      missatge: preusModificats > 0 ? "🚀 S'han convertit alguns preus!" : "⚠️ No s'ha pogut convertir res en aquest lot.",
      total_vins_celler: totalVins,
      preus_convertits_ara: preusModificats,
      vins_amb_problemes: mostresErrors.slice(0, 5) // Ens ensenya els 5 primers errors
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
