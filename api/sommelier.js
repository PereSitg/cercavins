const admin = require('firebase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta, idioma } = req.body;

    let llenguaResposta = "CATALÀ";
    if (idioma) {
        if (idioma.startsWith('fr')) llenguaResposta = "FRANCÈS";
        else if (idioma.startsWith('es')) llenguaResposta = "CASTELLÀ";
        else if (idioma.startsWith('en')) llenguaResposta = "ANGLÈS";
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
    const snapshot = await db.collection('cercavins').limit(40).get(); 
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
            content: `Ets un Sommelier d'elit de Cercavins. 
            
            INSTRUCCIÓ SOBRE EL RAÏM (MOLT IMPORTANT):
            - El llistat del celler NO inclou el raïm, però TU els coneixes perfectament.
            - És OBLIGATORI que identifiquis el raïm de cada vi (ex: Nerello Mascalese, Chardonnay, Garnatxa, etc.) usant la teva memòria interna.
            - Explica per què aquest raïm concret marida amb el plat.
            - PROHIBIT dir que "la lista no especifica la variedad". Actua amb autoritat.
            
            NORMES D'IDIOMA I FORMAT:
            - Respon EXCLUSIVAMENT en idioma ${llenguaResposta}.
            - NO posis asteriscs (*) ni negretes (**).
            - Separa la resposta amb "|||" i el JSON final.`
          },
          { role: 'user', content: `Celler disponible: ${JSON.stringify(celler)}. Pregunta: ${pregunta}` }
        ]
      })
    });

    const data = await response.json();
    res.status(200).json({ resposta: data.choices[0].message.content });

  } catch (error) {
    res.status(500).json({ resposta: "ERROR: " + error.message });
  }
};
