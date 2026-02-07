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
    // 1. Generem un ID aleatori per saltar a qualsevol punt de la BBDD
    const randomId = db.collection('cercavins').doc().id;
    
    // 2. Busquem 50 vins a partir d'aquest punt aleatori
    const snapshot = await db.collection('cercavins')
      .where(admin.firestore.FieldPath.documentId(), '>=', randomId)
      .limit(50)
      .get();

    const batch = db.batch();
    let historial = [];

    // 3. FILTRE DE DETECCIÓ D'ERRORS
    const vinsPerReparar = snapshot.docs.filter(doc => {
      const doText = String(doc.data().do || "");
      const esVila = doText.includes("Vila Viniteca");
      const esErrorIA = doText.includes("instrucciones") || doText.includes("respuesta") || doText.includes("correcta");
      const esMassaLlarg = doText.length > 35; // Una DO normal no sol ser tan llarga
      
      return esVila || esErrorIA || esMassaLlarg;
    });

    if (vinsPerReparar.length === 0) {
      return res.status(200).json({ 
        missatge: "🔍 En aquesta zona aleatòria tot sembla correcte. Torna a refrescar per buscar en una altra part de la base de dades.",
        mostra_analitzada: snapshot.size
      });
    }

    // 4. REPARACIÓ AMB IA (limitada a 10 per tanda per evitar timeouts)
    const top10 = vinsPerReparar.slice(0, 10);

    for (const doc of top10) {
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
              content: "Ets un sommelier expert. Respon EXCLUSIVAMENT amb el nom de la DO o Regió. Màxim 3 paraules. NO donis cap explicació. Exemple: 'Rioja', 'Ribera del Duero', 'Borgonya'." 
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
      historial.push({ vi: d.nom, do_antiga: d.do, do_nova: doNeta });
    }

    await batch.commit();

    return res.status(200).json({
      status: "🧼 Neteja aleatòria completada",
      vins_reparats: historial.length,
      detalls: historial
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
