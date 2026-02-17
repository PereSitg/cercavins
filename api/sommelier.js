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

    // 1. Recuperació àmplia per trobar vins específics (com el Cune)
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
            do_real: d.do || "DO",
            info: `${d.nom} ${d.do} ${d.varietat || ''} ${d.tipus || ''}`.toLowerCase()
          };
        })
        .filter(v => {
          // FILTRE DE SEGURETAT: URL vàlida i NO és el logo de Vila Viniteca
          const teFotoReal = v.imatge.startsWith('http') && !v.imatge.includes('viniteca');
          return teFotoReal;
        })
        .sort((a, b) => {
          // PRIORITAT: Si l'usuari busca "Cune", aquests vins van primer
          const aMatch = paraulesClau.some(clau => a.info.includes(clau));
          const bMatch = paraulesClau.some(clau => b.info.includes(clau));
          if (aMatch && !bMatch) return -1;
          if (!aMatch && bMatch) return 1;
          return Math.random() - 0.5;
        })
        .slice(0, 15);
    };

    const llistaAlta = filtrarVins(premSnap);
    const llistaEcon = filtrarVins(econSnap);

    // 2. PROMPT AMB INSTRUCCIONS DE SEGURETAT
    const promptSystem = `Ets un Sommelier d'elit. Respon en ${idiomaReal}. 
    Escriu unes 300 paraules. Sigues molt expert.
    
    IMPORTANT:
    - Tria EXACTAMENT 3 vins de la llista JSON que et passo.
    - Si l'usuari pregunta per un vi (ex: Cune), l'HAS de triar i explicar.
    - Usa la URL de la "imatge" tal qual. No t'inventis vins.
    
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
          { role: 'user', content: `Vins: ${JSON.stringify({alta: llistaAlta, econ: llistaEcon})}. Consulta: ${pregunta}` }
        ],
        temperature: 0.2
      })
    });

    const data = await groqResponse.json();
    const contingut = JSON.parse(data.choices[0].message.content);
    
    // 3. Resposta Final forçant el format JSON que ja tens al frontend
    res.status(200).json({ 
      resposta: `${contingut.explicacio} ||| ${JSON.stringify(contingut.vins_triats.slice(0, 3))}` 
    });

  } catch (error) {
    res.status(200).json({ resposta: `Error en el servei de sommelier. ||| []` });
  }
};
