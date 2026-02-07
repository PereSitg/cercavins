import admin from 'firebase-admin';

// Inicialitzem Firebase usant les variables d'entorn
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
const GROQ_KEY = process.env.GROQ_API_KEY;

export default async function handler(req, res) {
  // SEGURETAT: ?clau=pere
  if (req.query.clau !== 'pere') {
    return res.status(401).send('No autoritzat');
  }

  try {
    console.log("🧹 Iniciant procés de neteja i conversió de preus...");

    // Busquem 100 vins per processar en aquest lot
    const snapshot = await db.collection('cercavins').limit(100).get();

    if (snapshot.empty) {
      return res.status(200).json({ missatge: "✅ El celler està buit!" });
    }

    const batch = db.batch();
    let preusModificats = 0;
    let vinsPerDOReparar = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      let canvi = false;
      let updates = {};

      // --- 1. CONVERSIÓ DE PREU (de String a Number) ---
      if (typeof data.preu === 'string') {
        let preuNet = data.preu
          .replace('€', '')
          .replace(/\s/g, '')
          .replace(',', '.')
          .trim();
        
        const preuNumeric = parseFloat(preuNet);
        
        if (!isNaN(preuNumeric)) {
          updates.preu = preuNumeric;
          preusModificats++;
          canvi = true;
        }
      }

      // --- 2. DETECCIO DE DO "VILA VINITECA" ---
      if (data.do === 'Vila Viniteca') {
        vinsPerDOReparar.push({ id: doc.id, nom: data.nom });
      }

      if (canvi) {
        batch.update(doc.ref, updates);
      }
    });

    // --- 3. REPARACIÓ DE DO (Si n'hi ha) ---
    let missatgeIA = "No s'han trobat DO per reparar en aquest lot.";
    if (vinsPerDOReparar.length > 0 && GROQ_KEY) {
      const llistaVins = vinsPerDOReparar.map(v => `- ${v.nom}`).join('\n');
      
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          response_format: { type: "json_object" },
          messages: [{
            role: 'system',
            content: 'Ets un sommelier. Retorna un JSON amb els noms dels vins com a clau i la seva DO/Regió com a valor. Format: {"nom": "DO"}'
          }, {
            role: 'user',
            content: llistaVins
          }]
        })
      });

      const dataIA = await groqRes.json();
      const resultatsIA = JSON.parse(dataIA.choices[0].message.content);

      vinsPerDOReparar.forEach(vi => {
        const doReal = resultatsIA[vi.nom];
        if (doReal) {
          batch.update(db.collection('cercavins').doc(vi.id), { do: doReal });
        }
      });
      missatgeIA = `S'ha demanat la DO de ${vinsPerDOReparar.length} vins a la IA.`;
    }

    // Executem tots els canvis (preus + DOs)
    await batch.commit();

    return res.status(200).json({
      missatge: "🚀 Lot processat amb èxit",
      preus_convertits_a_numero: preusModificats,
      do_reparades: vinsPerDOReparar.length,
      detall_ia: missatgeIA
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
