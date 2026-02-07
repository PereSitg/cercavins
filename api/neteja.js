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
    // 1. Busquem 300 vins (pugem el límit per anar més ràpid) que NO siguin números
    const snapshot = await db.collection('cercavins')
      .limit(300)
      .get();

    const batch = db.batch();
    let modificats = 0;
    let buits = 0;

    snapshot.forEach(doc => {
      const data = doc.data();
      
      // Només processem si el preu NO és un número
      if (typeof data.preu !== 'number') {
        let preuOriginal = data.preu ? String(data.preu).trim() : "";
        
        if (preuOriginal === "") {
          // Si està buit, li posem un 0 perquè deixi de sortir a la llista de "pendents"
          batch.update(doc.ref, { preu: 0 });
          buits++;
        } else {
          // Si té text, el convertim
          let preuNet = preuOriginal
            .replace('€', '')
            .replace(/[^\d,.]/g, '')
            .replace(',', '.')
            .trim();

          const preuNumeric = parseFloat(preuNet);
          batch.update(doc.ref, { preu: isNaN(preuNumeric) ? 0 : preuNumeric });
          modificats++;
        }
      }
    });

    if (modificats > 0 || buits > 0) {
      await batch.commit();
    }

    return res.status(200).json({
      missatge: "🧹 Neteja en curs...",
      vins_amb_preu_convertit: modificats,
      vins_buits_marcats_com_zero: buits,
      total_processats_en_aquest_clic: modificats + buits,
      nota: "Si aquest número és alt, segueix refrescant fins arribar al final dels 8.348 vins."
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
