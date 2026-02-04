const admin = require('firebase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta, idioma } = req.body;

    let llenguaResposta = "CATALÀ";
    let termeUva = "raïm"; 
    
    if (idioma) {
        if (idioma.startsWith('es')) {
            llenguaResposta = "CASTELLÀ (ESPAÑOL)";
            termeUva = "uva";
        } else if (idioma.startsWith('fr')) {
            llenguaResposta = "FRANCÈS (FRANÇAIS)";
            termeUva = "raisin";
        } else if (idioma.startsWith('en')) {
            llenguaResposta = "ANGLÈS (ENGLISH)";
            termeUva = "grape";
        }
    }

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n').trim(),
        }),
      });
    }
    
    const db = admin.firestore();
    const paraulesClau = pregunta.split(' ').filter(p => p.length > 2);
    let query = db.collection('cercavins');
    let snapshot;

    // Millorem la cerca: si hi ha paraules clau, busquem per prefix
    if (paraulesClau.length > 0) {
        const cerca = paraulesClau[0].charAt(0).toUpperCase() + paraulesClau[0].slice(1).toLowerCase();
        snapshot = await query.where('nom', '>=', cerca).where('nom', '<=', cerca + '\uf8ff').limit(15).get();
    }

    if (!snapshot || snapshot.empty) {
        snapshot = await query.limit(20).get();
    }

    let celler = [];
    snapshot.forEach(doc => { 
      const d = doc.data();
      celler.push({ nom: d.nom, do: d.do, imatge: d.imatge, tipus: d.tipus, raim: d.raim || "Varietat típica de la zona" });
    });

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY?.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant', 
        messages: [
          { 
            role: 'system', 
            content: `Ets el sommelier expert de Cercavins. 
            INSTRUCCIONS DE RESPOSTA:
            1. Respon en ${llenguaResposta}.
            2. Per a cada vi recomanat: Escriu el nom, la D.O., el tipus de ${termeUva} i una nota de maridatge detallada.
            3. És OBLIGATORI que la resposta acabi amb "|||" i un JSON array amb els objectes dels vins triats (nom, do, imatge).
            4. Si el vi demanat és al celler, dóna tota la seva informació.`
          },
          { role: 'user', content: `Vins disponibles: ${JSON.stringify(celler)}. Pregunta de l'usuari: ${pregunta}` }
        ],
        temperature: 0.1
      })
    });

    const data = await response.json();
    res.status(200).json({ resposta: data.choices[0].message.content });

  } catch (error) {
    res.status(500).json({ resposta: "Error: " + error.message });
  }
};
