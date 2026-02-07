import admin from 'firebase-admin';

// Inicialitzem Firebase usant les variables d'entorn per seguretat
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

// LLEGIM LA CLAU DES DE VERCEL (Ja no la posem aquí en text)
const GROQ_KEY = process.env.GROQ_API_KEY;

export default async function handler(req, res) {
  // SEGURETAT: Només tu pots executar-ho si poses ?clau=pere al final de la URL
  if (req.query.clau !== 'pere') {
    return res.status(401).send('No autoritzat');
  }

  // Verificació interna que la clau de Groq existeix a Vercel
  if (!GROQ_KEY) {
    return res.status(500).json({ error: "Falta la variable GROQ_API_KEY a Vercel" });
  }

  try {
    console.log("🍷 Iniciant batch de neteja...");

    // 1. Busquem 50 vins amb la DO errònia
    const snapshot = await db.collection('cercavins')
      .where('do', '==', 'Vila Viniteca')
      .limit(50)
      .get();

    if (snapshot.empty) {
      return res.status(200).json({ missatge: "✅ Ja no queden vins per arreglar!" });
    }

    let llistaVins = "";
    let ids = [];

    snapshot.forEach(doc => {
      llistaVins += `- ${doc.data().nom}\n`;
      ids.push({ id: doc.id, nom: doc.data().nom });
    });

    // 2. Preguntem a Groq les DO reals
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
          content: 'Ets un sommelier expert. Retorna un JSON on les claus siguin els noms exactes i els valors les DO/Regions. Exemple: {"Nom": "Priorat"}'
        }, {
          role: 'user',
          content: llistaVins
        }]
      })
    });

    const data = await groqRes.json();
    
    if (data.error) throw new Error(data.error.message);
    
    const resultatsIA = JSON.parse(data.choices[0].message.content);

    // 3. Actualitzem Firebase en un sol Batch
    const batch = db.batch();
    let comptador = 0;

    ids.forEach(vi => {
      const doReal = resultatsIA[vi.nom];
      if (doReal) {
        batch.update(db.collection('cercavins').doc(vi.id), { do: doReal });
        comptador++;
      }
    });

    await batch.commit();

    return res.status(200).json({
      missatge: `🚀 S'han arreglat ${comptador} vins correctament.`,
      vins: resultatsIA
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
