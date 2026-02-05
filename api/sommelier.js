const admin = require('firebase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta, idioma } = req.body;

    // 1. Configuració d'idioma estricta
    const langMap = {
      'ca': { res: 'CATALÀ (ESTRICTE)', uva: 'raïm' },
      'es': { res: 'CASTELLANO (ESTRICTO)', uva: 'uva' },
      'en': { res: 'ENGLISH (STRICT)', uva: 'grape' },
      'fr': { res: 'FRANÇAIS (STRICT)', uva: 'raisin' }
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
    
    // 3. OBTENCIÓ TOTAL: Hem eliminat el .limit(50) per llegir TOT el celler
    const snapshot = await db.collection('cercavins').get();
    let celler = [];
    snapshot.forEach(doc => {
        const d = doc.data();
        celler.push({
            nom: d.nom,
            do: d.do,
            imatge: d.imatge,
            tipus: d.tipus,
            raim: d.raim || "Cupatge tradicional"
        });
    });

    // 4. Crida a la API Groq (Llama 3.3 70b)
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
            content: `Ets un Sommelier Tècnic de Cercavins. 

            INSTRUCCIONS DE FORMAT OBLIGATÒRIES:
            1. Respon SEMPRE en ${config.res}.
            2. NOMS DE VINS: Escriu-los en MAJÚSCULES i dins de <span class="nom-vi-destacat">NOM DEL VI</span>.
            3. PROHIBIT: No usis mai asteriscs (**), negretes de Markdown ni guions de llista.
            4. MARIDATGE: Per a marisc o carns blanques delicades, prioritza vins blancs o escumosos.
            
            ESTRUCTURA DE SORTIDA:
            [Text de la recomanació analítica]
            |||
            [{"nom":"nom en majúscules","imatge":"url"},{"nom":"...","imatge":"..."}]`
          },
          { role: 'user', content: `Catàleg complet: ${JSON.stringify(celler)}. Pregunta: ${pregunta}` }
        ],
        temperature: 0.1 // Forcem precisió màxima per evitar errors de format
      })
    });

    const data = await response.json();
    let respostaIA = data.choices[0].message.content;

    // Neteja i enviament de la resposta
    if (respostaIA.includes('|||')) {
        const parts = respostaIA.split('|||');
        const textNet = parts[0].trim();
        let jsonNet = parts[1].trim();
        
        // Assegurem que el JSON estigui ben tancat per evitar errors a la galeria
        const ultimaClau = jsonNet.lastIndexOf(']');
        if (ultimaClau !== -1) jsonNet = jsonNet.substring(0, ultimaClau + 1);
        
        res.status(200).json({ resposta: `${textNet} ||| ${jsonNet}` });
    } else {
        // Si la IA falla el separador, el posem nosaltres manualment
        res.status(200).json({ resposta: `${respostaIA} ||| []` });
    }

  } catch (error) {
    res.status(500).json({ resposta: "Error de connexió ||| []" });
  }
};
