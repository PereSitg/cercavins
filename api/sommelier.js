const admin = require('firebase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta, idioma } = req.body;

    // 1. Configuració d'idioma estricta per evitar barreges
    const langMap = {
      'ca': { res: 'idioma CATALÀ (estricte, sense excepcions)', uva: 'raïm' },
      'es': { res: 'idioma CASTELLANO (estricto, sin excepciones)', uva: 'uva' },
      'en': { res: 'ENGLISH language (strictly)', uva: 'grape' },
      'fr': { res: 'langue FRANÇAISE (strictement)', uva: 'raisin' }
    };
    const config = langMap[idioma?.slice(0,2)] || langMap['ca'];

    // 2. Inicialització de Firebase
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
    
    // 3. Obtenció de dades del celler
    const snapshot = await db.collection('cercavins').limit(50).get();
    let celler = [];
    snapshot.forEach(doc => {
        const d = doc.data();
        celler.push({
            nom: d.nom,
            do: d.do,
            imatge: d.imatge,
            tipus: d.tipus, // Important per diferenciar blanc/negre
            raim: d.raim || "Cupatge tradicional"
        });
    });

    // 4. Crida a la API (Model 70b actiu)
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
            content: `Ets un Sommelier Tècnic de Cercavins. El teu to és professional, directe i analític.

            NORMES DE MARIDATGE I CRITERI:
            1. Per a marisc (percebes, gambes, etc.) i peix blanc, recomana EXCLUSIVAMENT vins blancs o escumosos. Prohibit recomanar vins negres potents.
            2. Analitza l'acidesa i l'estructura de forma tècnica.

            NORMES DE RESPOSTA I IDIOMA:
            1. Respon EXCLUSIVAMENT en ${config.res}. Prohibit barrejar idiomes.
            2. Si demanen recomanació, tria entre 3 i 4 vins. Si pregunten per un vi concret, dona detalls tècnics i de varietat de ${config.uva}.
            3. FORMAT DELS NOMS: Escriu els noms en MAJÚSCULES dins de <span class="nom-vi-destacat">NOM DEL VI</span>.
            4. PROHIBIT: No usis asteriscs (**), ni negretes, ni llistes. Text narratiu professional.
            5. SEPARADOR OBLIGATORI: Acaba amb ||| i el JSON Array.`
          },
          { role: 'user', content: `Catàleg: ${JSON.stringify(celler)}. Pregunta: ${pregunta}` }
        ],
        temperature: 0.1 // Temperatura baixa per màxima precisió
      })
    });

    const data = await response.json();
    let respostaIA = data.choices[0].message.content;

    // Neteja de seguretat del JSON
    if (respostaIA.includes('|||')) {
        const parts = respostaIA.split('|||');
        const textNet = parts[0].trim();
        let jsonNet = parts[1].trim();
        const ultimaClau = jsonNet.lastIndexOf(']');
        if (ultimaClau !== -1) jsonNet = jsonNet.substring(0, ultimaClau + 1);
        res.status(200).json({ resposta: `${textNet} ||| ${jsonNet}` });
    } else {
        res.status(200).json({ resposta: respostaIA + " ||| []" });
    }

  } catch (error) {
    res.status(500).json({ resposta: "Error de connexió ||| []" });
  }
};
