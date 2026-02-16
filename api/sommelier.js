const admin = require('firebase-admin');

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

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta, idioma } = req.body;
    const p = pregunta.toLowerCase();
    
    const langMap = { 'ca': 'CATALÀ', 'es': 'CASTELLANO', 'en': 'ENGLISH', 'fr': 'FRANÇAIS' };
    const idiomaReal = langMap[(idioma || 'ca').toLowerCase().slice(0, 2)] || 'CATALÀ';

    // 1. Filtratge dinàmic (Món, Raïm, DO)
    const paraulesClau = p.split(/[ ,.!?]+/).filter(w => w.length > 3);

    const [premSnap, econSnap] = await Promise.all([
      db.collection('cercavins').where('preu', '>', 35).limit(40).get(),
      db.collection('cercavins').where('preu', '>=', 7).where('preu', '<=', 18).limit(40).get()
    ]);

    const processar = (snap) => {
      return snap.docs
        .map(doc => ({ 
          nom: doc.data().nom, 
          imatge: doc.data().imatge, 
          do: doc.data().do || "DO",
          cerca: `${doc.data().nom} ${doc.data().do} ${doc.data().varietat || ''} ${doc.data().tipus || ''}`.toLowerCase()
        }))
        .filter(v => {
          if (!v.imatge || v.do === "Vila Viniteca") return false;
          if (paraulesClau.length === 0) return true;
          return paraulesClau.some(clau => v.cerca.includes(clau)) || (p.includes('percebe') && v.cerca.includes('blanc'));
        })
        .sort(() => Math.random() - 0.5)
        .slice(0, 10);
    };

    const llistaAlta = processar(premSnap);
    const llistaEcon = processar(econSnap);

    // 2. Prompt amb instruccions per no tallar-se
    const promptSystem = `Ets un Sommelier d'elit. Respon en ${idiomaReal}. 
    Escriu una recomanació de unes 300 paraules. Sigues molt descriptiu.
    
    FORMAT ESTRICTE:
    - Vi: <span class="nom-vi-destacat">NOM</span>, DO: <span class="text-destacat-groc">DO</span>.
    
    IMPORTANT: Has de triar EXACTAMENT 3 vins (2 de gama alta i 1 econòmic). 
    Assegura't de tancar sempre el JSON correctament. No et quedis a mitges.
    
    JSON OBLIGATORI: {"explicacio": "...", "vins_triats": [{"nom": "...", "imatge": "..."}]}`;

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY?.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant', 
        response_format: { type: "json_object" },
        messages: [
          { role: 'system', content: promptSystem },
          { role: 'user', content: `Consulta: ${pregunta}. Vins reals: ${JSON.stringify({alta: llistaAlta, econ: llistaEcon})}` }
        ],
        temperature: 0.4 // Temperatura baixa per evitar que la IA s'inventi coses
      })
    });

    const data = await groqResponse.json();
    const contingut = JSON.parse(data.choices[0].message.content);
    
    // Forcem que sempre enviï 3 vins si n'ha triat menys per error
    const vinsFinals = (contingut.vins_triats || []).slice(0, 3);

    res.status(200).json({ 
      resposta: `${contingut.explicacio} ||| ${JSON.stringify(vinsFinals)}` 
    });

  } catch (error) {
    res.status(200).json({ resposta: `Error en la selecció. ||| []` });
  }
};
