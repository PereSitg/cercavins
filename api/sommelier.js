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
    const p = pregunta.toLowerCase();
    
    // 1. FILTRATGE INTEL·LIGENT DE FIREBASE
    let query = db.collection('cercavins');

    if (p.includes('blanc') || p.includes('peix') || p.includes('marisc') || p.includes('arròs') || p.includes('percebe')) {
      query = query.where('tipus', '==', 'Blanc');
    } else if (p.includes('negre') || p.includes('carn') || p.includes('vedella') || p.includes('formatge')) {
      query = query.where('tipus', '==', 'Negre');
    } else if (p.includes('rosat')) {
      query = query.where('tipus', '==', 'Rosat');
    } else if (p.includes('escumós') || p.includes('cava') || p.includes('champagne') || p.includes('corpinnat')) {
      query = query.where('tipus', '==', 'Escumós');
    } else {
      // Si la cerca és genèrica, limitem a 150 per seguretat
      query = query.limit(150);
    }

    const snapshot = await query.get();
    let celler = [];
    snapshot.forEach(doc => {
        const d = doc.data();
        celler.push({ n: d.nom, t: d.tipus, i: d.imatge });
    });

    // 2. CRIDA A LA IA (Ara el catàleg ja ve filtrat i no donarà error)
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
            content: `Sommelier técnico. Idioma: ${config.res}. 
            REGLAS:
            1. Nombres en MAJÚSCULAS y <span class="nom-vi-destacat">NOMBRE</span>.
            2. Prohibido usar asteriscos (**).
            3. Estilo narrativo.
            4. Separador obligatorio: Texto ||| [{"nom":"...","imatge":"..."}]`
          },
          { 
            role: 'user', 
            content: `Catálogo filtrado: ${JSON.stringify(celler)}. Pregunta: ${pregunta}` 
          }
        ],
        temperature: 0.1
      })
    });

    if (!response.ok) {
        return res.status(200).json({ resposta: "Ho sento, encara hi ha massa dades. Prova de ser més específic (blanc, negre...). ||| []" });
    }

    const data = await response.json();
    let respostaIA = data.choices[0].message.content;

    if (respostaIA.includes('|||')) {
        res.status(200).json({ resposta: respostaIA });
    } else {
        res.status(200).json({ resposta: `${respostaIA} ||| []` });
    }

  } catch (error) {
    res.status(500).json({ resposta: "Error de connexió ||| []" });
  }
};
