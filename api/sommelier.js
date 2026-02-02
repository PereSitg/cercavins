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
    const snapshot = await db.collection('cercavins').limit(20).get(); 
    let celler = [];
    
    snapshot.forEach(doc => { 
      const d = doc.data();
      celler.push({
        nom: d.nom,
        do: d.do,
        imatge: d.imatge, 
        tipus: d.tipus
      });
    });

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY?.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile', 
        messages: [
          { 
            role: 'system', 
            content: `Ets el sommelier de Cercavins. 
            NORMES CRÍTIQUES:
            1. Respon SEMPRE en ${llenguaResposta}. Està prohibit barrejar paraules en català si respon l'idioma no és català. (Exemple: si respons en castellà, mai diguis "raïm", digues sempre "${termeUva}").
            2. Per a cada vi recomanat, identifica la seva varietat de ${termeUva} usant la teva memòria interna. Explica breument per què va bé amb el plat.
            3. NO MENCIONIS EL PREU.
            4. Recomana 3 o 4 vins.
            5. Al final, afegeix "|||" i el JSON (nom, do, imatge).`
          },
          { role: 'user', content: `Vins: ${JSON.stringify(celler)}. Pregunta: ${pregunta}` }
        ]
      })
    });

    const data = await response.json();
    res.status(200).json({ resposta: data.choices[0].message.content });

  } catch (error) {
    res.status(500).json({ resposta: "ERROR: " + error.message });
  }
};
