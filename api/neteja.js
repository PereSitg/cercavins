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
    // 1. Busquem 15 vins que estiguin malament:
    // - O diuen "Vila Viniteca"
    // - O contenen el text d'error de la IA ("instrucciones")
    const snapshot = await db.collection('cercavins')
      .limit(15)
      .get();

    const batch = db.batch();
    let historial = [];

    // Filtrem manualment per trobar els que necessiten reparació
    const vinsPerReparar = snapshot.docs.filter(doc => {
      const doText = doc.data().do || "";
      return doText === "Vila Viniteca" || doText.includes("instrucciones") || doText.includes("respuesta");
    });

    if (vinsPerReparar.length === 0) {
      return res.status(200).json({ missatge: "✅ Tot net! No s'han trobat errors de 'Vila Viniteca' ni de la IA en aquesta mostra." });
    }

    for (const doc of vinsPerReparar) {
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
              content: "Ets un sommelier expert. Respon EXCLUSIVAMENT amb el nom de la Denominació d'Origen o Regió. NO donis explicacions. NO diguis si tens instruccions o no. Exemple: 'Rioja', 'Borgonya', 'Mendoza'." 
            },
            { role: 'user', content: `DO del vi: ${d.nom}` }
          ],
          temperature: 0.1
        })
      });

      const aiData = await groqRes.json();
      let doNeta = aiData.choices?.[0]?.message?.content?.trim() || "DO Desconeguda";
      
      // Neteja extra per si la IA encara posa punts o cometes
      doNeta = doNeta.replace(/\./g, '').replace(/"/g, '');

      batch.update(doc.ref, { do: doNeta });
      historial.push({ vi: d.nom, do_reparada: doNeta });
    }

    await batch.commit();

    return res.status(200).json({
      status: "Reparació completada",
      vins_arreglats: historial.length,
      detalls: historial
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
