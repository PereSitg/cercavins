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
  // Seguretat per evitar que ningú més executi la neteja
  if (req.query.clau !== 'pere') return res.status(401).send('No autoritzat');

  try {
    // 1. Busquem vins on la DO sigui "Vila Viniteca" o estigui buida
    // Ho fem de 10 en 10 per no esgotar el temps d'execució de Vercel (max 10-15 segons)
    const snapshot = await db.collection('cercavins')
      .where('do', '==', 'Vila Viniteca')
      .limit(10)
      .get();

    if (snapshot.empty) {
      return res.status(200).json({ 
        missatge: "✅ No s'han trobat més vins amb la DO 'Vila Viniteca' en aquesta tanda." 
      });
    }

    const batch = db.batch();
    let historial = [];

    // 2. Iterem sobre els vins trobats i preguntem a la IA
    for (const doc of snapshot.docs) {
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
              content: 'Ets un sommelier expert. Se t\'anomenarà un vi i només has de respondre amb el nom de la seva Denominació d\'Origen (DO). No posis frases, ni punts, ni "La DO és...". Només el nom.' 
            },
            { role: 'user', content: `Quin és el nom de la DO del vi: ${d.nom}?` }
          ],
          temperature: 0.1 // Perquè sigui molt precís
        })
      });

      const aiData = await groqRes.json();
      const doCorrecta = aiData.choices?.[0]?.message?.content?.trim() || "DO Desconeguda";

      // 3. Preparem l'actualització
      batch.update(doc.ref, { do: doCorrecta });
      historial.push({ vi: d.nom, do_vella: d.do, do_nova: doCorrecta });
    }

    // 4. Guardem tots els canvis de cop
    await batch.commit();

    return res.status(200).json({
      status: "Succés",
      vins_arreglats: historial.length,
      detalls: historial,
      nota: "Torna a carregar la pàgina per arreglar 10 vins més."
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
