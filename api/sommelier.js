const admin = require('firebase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta, idioma } = req.body;
    const p = pregunta.toLowerCase();

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

    // FILTRE RADICAL PER VELOCITAT (Només agafem 40 vins, els més rellevants)
    if (p.includes('blanc') || p.includes('peix') || p.includes('marisc') || p.includes('percebe') || p.includes('fish') || p.includes('poisson')) {
      query = query.where('tipus', '==', 'Blanc').limit(40);
    } else if (p.includes('negre') || p.includes('tinto') || p.includes('red') || p.includes('rouge') || p.includes('carn') || p.includes('meat')) {
      query = query.where('tipus', '==', 'Negre').limit(40);
    } else {
      query = query.limit(40); // Si no sabem què busca, només 40 per anar ràpid
    }

    const snapshot = await query.get();
    let celler = [];
    snapshot.forEach(doc => {
        const d = doc.data();
        celler.push({ n: d.nom, t: d.tipus, i: d.imatge });
    });

    // CRIDA A GROQ AMB MODEL MÉS LLEUGER (Llama 8B) PER EVITAR TIMEOUT
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY?.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192', // Aquest model respon en 1 segon, el 70B és massa lent per a Vercel
        messages: [
          { 
            role: 'system', 
            content: `Sommelier professional. Idioma: ${config.res}. 
            1. NO MAJÚSCULES. 
            2. Noms en groc: <span class="nom-vi-destacat">nom del vi</span>. 
            3. Recomana 3 vins del catàleg.
            4. Format: Text ||| [{"nom":"...","imatge":"..."}]`
          },
          { 
            role: 'user', 
            content: `Vins: ${JSON.stringify(celler)}. Pregunta: ${pregunta}` 
          }
        ],
        temperature: 0.2
      })
    });

    const data = await response.json();
    let respostaIA = data.choices[0].message.content;

    res.status(200).json({ 
      resposta: respostaIA.includes('|||') ? respostaIA : `${respostaIA} ||| []` 
    });

  } catch (error) {
    res.status(200).json({ resposta: "error de temps. prova de ser més específic (blanc o negre). ||| []" });
  }
};
