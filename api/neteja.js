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
    // Pugem a 15 vins per aprofitar millor cada càrrega
    const snapshot = await db.collection('cercavins')
      .where('do', '==', 'Vila Viniteca')
      .limit(15) 
      .get();

    if (snapshot.empty) {
      return res.status(200).json({ 
        missatge: "✅ Ja no queden més vins amb la DO 'Vila Viniteca'!" 
      });
    }

    const batch = db.batch();
    let historial = [];

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
              content: `Ets un sommelier expert i rigorós. La teva missió és identificar la Denominació d'Origen (DO) exacta.
              INSTRUCCIONS CRÍTIQUES:
              1. Si el vi és de 'Comando G' o 'Reina de los Deseos', la DO és 'Vinos de Madrid'.
              2. Si el vi és de 'Alemany i Corrió' o 'Sot Lefriec', la DO és 'Penedès'.
              3. Si el vi és de 'Bellaserra', la DO és 'Catalunya'.
              4. Si el vi és de 'Descendientes de J. Palacios' (La Faraona, Corullón), la DO és 'Bierzo'.
              5. Per a vins francesos, especifica la zona: 'Borgonya', 'Champagne', 'Bordeus', etc.
              6. RESPON NOMÉS EL NOM DE LA DO. No posis frases ni punts final.` 
            },
            { role: 'user', content: `Quin és el nom de la DO oficial del vi: ${d.nom}?` }
          ],
          temperature: 0.1
        })
      });

      const aiData = await groqRes.json();
      const doCorrecta = aiData.choices?.[0]?.message?.content?.trim() || "DO Desconeguda";

      batch.update(doc.ref, { do: doCorrecta });
      historial.push({ vi: d.nom, do_vella: d.do, do_nova: doCorrecta });
    }

    await batch.commit();

    return res.status(200).json({
      status: "Succés",
      vins_arreglats: historial.length,
      detalls: historial,
      nota: "Continua refrescant fins que el comptador arribi a 0."
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
