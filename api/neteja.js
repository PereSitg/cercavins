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
    
    // Cerquem 50 documents per trobar errors de forma aleatòria
    const snapshot = await db.collection('cercavins')
      .where(admin.firestore.FieldPath.documentId(), '>=', randomId)
      .limit(50)
      .get();

    const batch = db.batch();
    let historial = [];

    // Filtrem els que tenen Vila Viniteca o els "Desconeguda" de l'intent anterior
    const vinsPerReparar = snapshot.docs.filter(doc => {
      const doText = String(doc.data().do || "");
      return doText.includes("Vila Viniteca") || 
             doText.includes("Desconeguda") || 
             doText.includes("instrucciones") ||
             doText.length > 35;
    });

    if (vinsPerReparar.length === 0) {
      return res.status(200).json({ 
        missatge: "🔍 Sembla que aquesta zona està neta. Refresca per saltar a una altra part!" 
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
              role: 'user', 
              content: `Ets un sommelier expert. Digues només el nom de la regió vinícola o Denominació d'Origen d'aquest vi: "${d.nom}". Respon només el nom de la zona, sense frases, ni punts, ni explicacions.` 
            }
          ],
          temperature: 0.1
        })
      });

      const aiData = await groqRes.json();
      let doNeta = aiData.choices?.[0]?.message?.content?.trim() || "DO Pendent";
      
      // Neteja final de format (llevem punts, cometes i el prefix "DO ")
      doNeta = doNeta.replace(/\./g, '').replace(/"/g, '').replace(/^DO /i, '');

      batch.update(doc.ref, { do: doNeta });
      historial.push({ vi: d.nom, abans: d.do, ara: doNeta });
    }

    await batch.commit();

    return res.status(200).json({
      status: "🚀 NETEJA SIMPLIFICADA EXECUTADA",
      vins_reparats: historial
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
