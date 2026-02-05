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
    
    // 1. AGAFEM EL CELLER (Límit de seguretat de 150 per evitar errors de la IA)
    const snapshot = await db.collection('cercavins').limit(150).get();
    let celler = [];
    snapshot.forEach(doc => {
        const d = doc.data();
        celler.push({ n: d.nom, t: d.tipus, i: d.imatge });
    });

    // 2. CRIDA A LA IA (Model 70b per a màxima qualitat)
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
            content: `Ets un sommelier professional. Respon en ${config.res}. 
            NORMES OBLIGATÒRIES:
            1. Has d'oferir exactament 3 o 4 vins del catàleg proporcionat.
            2. No usis MAJÚSCULES. Usa text normal.
            3. Els noms dels vins han d'anar dins de: <span class="nom-vi-destacat">nom del vi</span> (perquè surtin en groc).
            4. No usis asteriscs (**).
            5. FORMAT DE SORTIDA: Text explicatiu ||| [{"nom":"nom","imatge":"url"}]`
          },
          { 
            role: 'user', 
            content: `Catàleg: ${JSON.stringify(celler)}. Pregunta: ${pregunta}` 
          }
        ],
        temperature: 0.3 // Pugem una mica perquè sigui més creatiu triant vins
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
