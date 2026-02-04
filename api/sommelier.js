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
    
    // FILTRE DE SEGURETAT: Si l'usuari pregunta per un vi concret, el busquem SI O SI.
    const paraules = pregunta.split(' ').filter(p => p.length > 2);
    let celler = [];
    
    // Intentem buscar el vi pel nom a Firebase
    if (paraules.length > 0) {
        const busqueda = paraules[0].charAt(0).toUpperCase() + paraules[0].slice(1).toLowerCase();
        const snap = await db.collection('cercavins')
            .where('nom', '>=', busqueda)
            .where('nom', '<=', busqueda + '\uf8ff')
            .limit(10).get();
        
        snap.forEach(doc => celler.push(doc.data()));
    }

    // Si no trobem res amb el nom, portem els 40 primers per tenir varietat
    if (celler.length === 0) {
        const snapGeneral = await db.collection('cercavins').limit(40).get();
        snapGeneral.forEach(doc => celler.push(doc.data()));
    }

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
            content: `Ets el sommelier de Cercavins. 
            NORMES ABSOLUTES:
            1. Respon SEMPRE en ${llenguaResposta}.
            2. NOMÉS pots recomanar vins que apareguin al fitxer JSON que t'envio. ESTÀ PROHIBIT inventar-se vins (com Borsao).
            3. Si el vi NO és a la llista, digues que no el tens i recomana'n un de la llista que s'hi assembli per D.O. o tipus.
            4. Per a cada vi: nom, D.O., varietat de ${termeUva} i maridatge.
            5. EL FINAL DE LA RESPOSTA HA DE SER: "|||" seguit del JSON array [ {"nom": "...", "do": "...", "imatge": "..."} ].
            6. NO escriguis res de text després del separador "|||".`
          },
          { role: 'user', content: `Llista de vins reals: ${JSON.stringify(celler)}. Pregunta: ${pregunta}` }
        ],
        temperature: 0 // Creativitat zero per evitar invencions
      })
    });

    const data = await response.json();
    res.status(200).json({ resposta: data.choices[0].message.content });

  } catch (error) {
    res.status(500).json({ resposta: "Error: " + error.message + " ||| []" });
  }
};
