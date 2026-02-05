const admin = require('firebase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta, idioma } = req.body;
    const p = pregunta.toLowerCase();

    // MAPA D'IDIOMES COMPLET (Català, Castellà, Anglès, Francès)
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
    let query = db.collection('cercavins');

    // FILTRATGE INTEL·LIGENT (Segons paraules clau en la pregunta)
    if (p.includes('blanc') || p.includes('peix') || p.includes('marisc') || p.includes('percebe') || p.includes('fish') || p.includes('poisson')) {
      query = query.where('tipus', '==', 'Blanc');
    } else if (p.includes('negre') || p.includes('tinto') || p.includes('red') || p.includes('rouge') || p.includes('carn') || p.includes('meat')) {
      query = query.where('tipus', '==', 'Negre');
    } else if (p.includes('rosat') || p.includes('rose')) {
      query = query.where('tipus', '==', 'Rosat');
    } else if (p.includes('escumós') || p.includes('cava') || p.includes('sparkling') || p.includes('pétillant')) {
      query = query.where('tipus', '==', 'Escumós');
    }

    const snapshot = await query.get();
    let celler = [];
    snapshot.forEach(doc => {
        const d = doc.data();
        celler.push({ n: d.nom, t: d.tipus, i: d.imatge });
    });

    // Si el filtre no troba res, agafem una mostra general per no donar error
    if (celler.length === 0) {
      const backupSnap = await db.collection('cercavins').limit(100).get();
      backupSnap.forEach(doc => {
          const d = doc.data();
          celler.push({ n: d.nom, t: d.tipus, i: d.imatge });
      });
    }

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
            content: `Ets un sommelier expert. Respon en ${config.res}.
            NORMES:
            1. No usis MAJÚSCULES (escriu suau).
            2. Noms de vins en groc: <span class="nom-vi-destacat">nom del vi</span>.
            3. Recomana 3 vins reals del catàleg.
            4. FORMAT OBLIGATORI: Text explicatiu ||| [{"nom":"...","imatge":"..."}]`
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
    let respostaIA = data.choices[0].message.content;

    res.status(200).json({ 
      resposta: respostaIA.includes('|||') ? respostaIA : `${respostaIA} ||| []` 
    });

  } catch (error) {
    res.status(200).json({ resposta: "Error ||| []" });
  }
};
