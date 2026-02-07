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
    const randomId = db.collection('cercavins').doc().id;
    
    // Cerquem 50 documents per trobar errors
    const snapshot = await db.collection('cercavins')
      .where(admin.firestore.FieldPath.documentId(), '>=', randomId)
      .limit(50)
      .get();

    const batch = db.batch();
    let historial = [];

    const vinsPerReparar = snapshot.docs.filter(doc => {
      const doText = String(doc.data().do || "");
      // Ara també reparem si ha posat "Desconeguda" o "Aragó" erròniament en vins que sabem que no ho són
      return doText.includes("Vila Viniteca") || 
             doText.includes("instrucciones") || 
             doText.includes("Desconeguda") || 
             doText.length > 35;
    });

    if (vinsPerReparar.length === 0) {
      return res.status(200).json({ 
        missatge: "🔍 Cap error trobat en aquesta zona. Segueix buscant!" 
      });
    }

    for (const doc of vinsPerReparar.slice(0, 10)) {
      const d = doc.data();
      
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { 
              role: 'system', 
              content: `Ets un sommelier mestre. Identifica la DO oficial.
              DICCIONARI DE CORRECCIÓ:
              - 'Bimbache': DO El Hierro.
              - 'Sierra Cantabria' o 'Viñedos de Páganos': DO Ca Rioja.
              - 'Alcor': DO Alicante.
              - 'Muchada-Léclapart': Cádiz (Vinos de la Tierra).
              - 'Dominio de Es': DO Ribera del Duero.
              - 'Zuccardi' o 'Catena Zapata': Mendoza (Argentina).
              - 'Willi Schaefer': Mosel (Alemanya).
              - 'Étienne Calsac': Champagne (França).
              - 'La Nieta': DO Ca Rioja.
              REGLES: Respon NOMÉS el nom de la DO o Regió. Màxim 3 paraules.` 
            },
            { role: 'user', content: `DO del vi: ${d.nom}` }
          ],
          temperature: 0.1
        })
      });

      const aiData = await groqRes.json();
      let doNeta = aiData.choices?.[0]?.message?.content?.trim() || "DO Desconeguda";
      doNeta = doNeta.replace(/\./g, '').replace(/"/g, '');

      batch.update(doc.ref, { do: doNeta });
      historial.push({ vi: d.nom, de: d.do, a: doNeta });
    }

    await batch.commit();

    return res.status(200).json({
      status: "✅ Neteja amb diccionari actualitzat",
      reparats: historial
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
