const admin = require('firebase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta, idioma } = req.body;

    const langMap = {
      'ca': { res: 'CATALÀ' },
      'es': { res: 'CASTELLANO' }
    };
    const config = langMap[idioma?.slice(0,2)] || langMap['ca'];

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
    
    // 1. AGAFEM TOT EL CELLER SENSE LÍMITS
    const snapshot = await db.collection('cercavins').get();
    let celler = [];
    snapshot.forEach(doc => {
        const d = doc.data();
        // Només n, t i i (mínim espai per evitar errors de connexió)
        celler.push({ n: d.nom, t: d.tipus, i: d.imatge });
    });

    // 2. CRIDA A LA IA
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
            content: `Ets un sommelier. Respon en ${config.res}. 
            NORMES:
            1. NO MAJÚSCULES. 
            2. Noms en groc: <span class="nom-vi-destacat">nom del vi</span>. 
            3. Tria almenys 3 vins.
            4. FORMAT: Text ||| [{"nom":"...","imatge":"..."}]`
          },
          { 
            role: 'user', 
            content: `Celler: ${JSON.stringify(celler)}. Pregunta: ${pregunta}` 
          }
        ],
        temperature: 0.3
      })
    });

    const data = await response.json();
    
    if (data.error) {
        // Si la IA ens diu que el catàleg és massa gran, ho sabrem per la consola
        console.error("Error de Groq:", data.error.message);
        throw new Error("Massa dades");
    }

    let respostaIA = data.choices[0].message.content;

    if (respostaIA.includes('|||')) {
        const parts = respostaIA.split('|||');
        res.status(200).json({ resposta: `${parts[0].trim()} ||| ${parts[1].trim()}` });
    } else {
        res.status(200).json({ resposta: `${respostaIA} ||| []` });
    }

  } catch (error) {
    console.error("Error detectat:", error);
    res.status(200).json({ 
        resposta: "He tingut un problema en buscar al celler (possiblement és massa gran). Prova de preguntar per un tipus de vi concret (blanc, negre...). ||| []" 
    });
  }
};
