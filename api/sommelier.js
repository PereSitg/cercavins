const admin = require('firebase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta, idioma } = req.body;
    const p = (pregunta || "").toLowerCase();

    // Idiomes
    const langMap = { 'ca': 'CATALÀ', 'es': 'CASTELLANO', 'en': 'ENGLISH', 'fr': 'FRANÇAIS' };
    const idiomaRes = langMap[idioma?.slice(0,2)] || 'CATALÀ';

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
      });
    }
    
    const db = admin.firestore();
    
    // LA SOLUCIÓ FINAL: Només demanem 8 vins. 
    // És una quantitat tan petita que Firebase la serveix en mil·lisegons.
    let query = db.collection('cercavins');
    
    if (p.includes('blanc') || p.includes('peix') || p.includes('percebe')) {
      query = query.where('tipus', '==', 'Blanc');
    } else if (p.includes('negre') || p.includes('carn')) {
      query = query.where('tipus', '==', 'Negre');
    }
    
    const snapshot = await query.limit(8).get();
    let celler = [];
    snapshot.forEach(doc => {
        const d = doc.data();
        if (d.nom && d.imatge) {
          celler.push({ n: d.nom.toLowerCase(), i: d.imatge });
        }
    });

    // Si Firebase està buit per la quota, no cridem a la IA i avisem
    if (celler.length === 0) {
      return res.status(200).json({ resposta: "el celler està tancat per descans setmanal (quota esgotada). torna demà! ||| []" });
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY?.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192', 
        messages: [
          { 
            role: 'system', 
            content: `sommelier. respon en ${idiomaRes}. tot minúscules. noms en groc: <span class="nom-vi-destacat">nom</span>. tria 2-3 vins. format: text ||| [{"nom":"...","imatge":"..."}]`
          },
          { role: 'user', content: `vins: ${JSON.stringify(celler)}. pregunta: ${pregunta}` }
        ],
        temperature: 0.2
      })
    });

    const data = await response.json();
    const respostaIA = data.choices[0].message.content;

    res.status(200).json({ 
      resposta: respostaIA.includes('|||') ? respostaIA : `${respostaIA} ||| []` 
    });

  } catch (error) {
    res.status(200).json({ 
      resposta: "error de connexió. probablament la quota de firebase s'ha acabat. ||| []" 
    });
  }
};
