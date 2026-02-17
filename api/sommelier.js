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
    const p = (pregunta || "").toLowerCase();
    
    const langMap = { 'ca': 'CATALÀ', 'es': 'CASTELLANO', 'en': 'ENGLISH', 'fr': 'FRANÇAIS' };
    const idiomaReal = langMap[(idioma || 'ca').toLowerCase().slice(0, 2)] || 'CATALÀ';

    const paraulesClau = p.split(/[ ,.!?]+/).filter(w => w.length > 2);

    // 1. Recuperació de vins (Límit de 100 per categoria)
    const [premSnap, econSnap] = await Promise.all([
      db.collection('cercavins').where('preu', '>', 35).limit(100).get(),
      db.collection('cercavins').where('preu', '>=', 7).where('preu', '<=', 18).limit(100).get()
    ]);

    const filtrarVins = (snap) => {
      return snap.docs
        .map(doc => {
          const d = doc.data();
          return { 
            nom: d.nom || "", 
            imatge: d.imatge || "", 
            do: d.do || "DO",
            info: `${d.nom} ${d.do} ${d.varietat || ''} ${d.tipus || ''}`.toLowerCase()
          };
        })
        .filter(v => v.imatge.startsWith('http') && !v.imatge.includes('viniteca'))
        .sort((a, b) => {
          // PRIORITAT: Si l'usuari pregunta per un nom (ex: "Cune"), surt primer
          const aMatch = paraulesClau.some(clau => a.info.includes(clau));
          const bMatch = paraulesClau.some(clau => b.info.includes(clau));
          if (aMatch && !bMatch) return -1;
          if (!aMatch && bMatch) return 1;
          return Math.random() - 0.5;
        });
    };

    const llistaAlta = filtrarVins(premSnap);
    const llistaEcon = filtrarVins(econSnap);

    // Si no trobem res, agafem els primers per defecte per evitar que falli
    const llistaFinal = [...llistaAlta.slice(0, 15), ...llistaEcon.slice(0, 15)];

    // 2. Prompt per a Groq
    const promptSystem = `Ets un Sommelier d'elit. Respon en ${idiomaReal}. 
    Escriu unes 300 paraules. Sigues molt expert.
    REGLA: Tria EXACTAMENT 3 vins de la llista JSON. No t'inventis noms ni fotos.
    FORMAT: <span class="nom-vi-destacat">NOM</span> i <span class="text-destacat-groc">DO</span>.`;

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
          { role: 'user', content: `Vins: ${JSON.stringify(llistaFinal)}. Pregunta: ${pregunta}` }
        ],
        temperature: 0.2
      })
    });

    const data = await groqResponse.json();
    if (!data.choices) throw new Error("Error en Groq");

    const contingut = JSON.parse(data.choices[0].message.content);
    
    // 3. Verificació final d'imatges
    const vinsTriats = (contingut.vins_triats || []).slice(0, 3).map(vIA => {
      const original = llistaFinal.find(f => f.nom === vIA.nom) || llistaFinal[0];
      return { nom: original.nom, imatge: original.imatge };
    });

    res.status(200).json({ 
      resposta: `${contingut.explicacio} ||| ${JSON.stringify(vinsTriats)}` 
    });

  } catch (error) {
    console.error("Error detallat:", error);
    res.status(200).json({ 
      resposta: `Ho sento, estic triant les millors copes per a tu. Torna a preguntar! ||| []` 
    });
  }
};
