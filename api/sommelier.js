const admin = require('firebase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta, idioma } = req.body;

    const langMap = {
      'ca': { res: 'CATALÀ' },
      'es': { res: 'CASTELLANO' },
      'en': { res: 'ENGLISH' },
      'fr': { res: 'FRANÇAIS' }
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
    
    // 1. AGAFEM TOT EL CELLER (sense límits per mirar-los tots)
    const snapshot = await db.collection('cercavins').get();
    let celler = [];
    snapshot.forEach(doc => {
        const d = doc.data();
        celler.push({ n: d.nom, t: d.tipus, i: d.imatge });
    });

    // 2. CRIDA A LA IA AMB ORDRES DE FORMAT AMISTÓS
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
            content: `Ets un sommelier amable i expert. Respon en ${config.res}.
            
            NORMES DE TO I FORMAT:
            1. PROHIBIT USAR MAJÚSCULES per als noms dels vins. Escriu-los en minúscula, de forma suau.
            2. COLOR GROC: Posa el nom del vi SEMPRE dins de <span class="nom-vi-destacat">nom del vi</span>.
            3. RECOMANACIÓ: Tria almenys 3 vins reals del catàleg que enviem.
            4. No usis asteriscs (**).
            5. FORMAT: Text explicatiu ||| [{"nom":"nom","imatge":"url"}]`
          },
          { 
            role: 'user', 
            content: `Catàleg: ${JSON.stringify(celler)}. Pregunta: ${pregunta}` 
          }
        ],
        temperature: 0.3
      })
    });

    const data = await response.json();
    let respostaIA = data.choices[0].message.content;

    // 3. NETEJA I ENVIAMENT
    if (respostaIA.includes('|||')) {
        res.status(200).json({ resposta: respostaIA });
    } else {
        res.status(200).json({ resposta: `${respostaIA} ||| []` });
    }

  } catch (error) {
    res.status(500).json({ resposta: "Error de connexió ||| []" });
  }
};
