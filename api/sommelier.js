const admin = require('firebase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta, idioma } = req.body;
    const p = pregunta.toLowerCase();

    const langMap = { 'ca': 'CATALÀ', 'es': 'CASTELLANO', 'en': 'ENGLISH', 'fr': 'FRANÇAIS' };
    const idiomaRes = langMap[idioma?.slice(0,2)] || 'CATALÀ';

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
    
    // 1. FILTRE RADICAL (Només 15 vins per garantir velocitat de llamp)
    let query = db.collection('cercavins');
    if (p.includes('blanc') || p.includes('peix')) {
      query = query.where('tipus', '==', 'Blanc').limit(15);
    } else if (p.includes('negre') || p.includes('carn')) {
      query = query.where('tipus', '==', 'Negre').limit(15);
    } else {
      query = query.limit(15);
    }

    const snapshot = await query.get();
    let celler = [];
    snapshot.forEach(doc => {
        const d = doc.data();
        // Enviem el mínim text possible
        celler.push({ n: d.nom.toLowerCase(), i: d.imatge });
    });

    // 2. CRIDA A LA IA AMB EL MODEL MÉS RÀPID DEL MÓN
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
            content: `Sommelier. Respon en ${idiomaRes}. 
            1. TOT MINÚSCULES. 
            2. Noms: <span class="nom-vi-destacat">nom</span>. 
            3. 3 vins del catàleg. 
            4. FORMAT: Text ||| [{"nom":"...","imatge":"..."}]`
          },
          { role: 'user', content: `Vins: ${JSON.stringify(celler)}. Pregunta: ${pregunta}` }
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
    // Si falla, enviem un missatge més informatiu per saber què passa
    res.status(200).json({ 
      resposta: "el celler està tardant massa a respondre. prova de preguntar només per 'vins blancs' o 'vins negres'. ||| []" 
    });
  }
};
