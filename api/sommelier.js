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

    // 1. LÒGICA DE FILTRATGE PREVI (Plats i Marcas)
    const paraulesClau = p.split(/[ ,.!?]+/).filter(w => w.length > 2);
    
    // Diccionari ràpid per a plats típics
    const esMarisc = p.includes('percebe') || p.includes('marisc') || p.includes('gambes');
    const esCarn = p.includes('conill') || p.includes('carn') || p.includes('vedella');

    const [premSnap, econSnap] = await Promise.all([
      db.collection('cercavins').where('preu', '>', 35).limit(100).get(),
      db.collection('cercavins').where('preu', '>=', 7).where('preu', '<=', 18).limit(100).get()
    ]);

    const processarVins = (snap) => {
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
        .filter(v => v.imatge.startsWith('http') && !v.imatge.includes('viniteca')) // Filtre anti-logo
        .sort((a, b) => {
          // Prioritat 1: Coincidència de marca (ex: "Cune")
          const aMarca = paraulesClau.some(clau => a.info.includes(clau));
          const bMarca = paraulesClau.some(clau => b.info.includes(clau));
          if (aMarca && !bMarca) return -1;
          if (!aMarca && bMarca) return 1;

          // Prioritat 2: Maridatge per tipus de plat
          if (esMarisc) {
            const aBlanc = a.info.includes('blanc') || a.info.includes('albariño');
            const bBlanc = b.info.includes('blanc') || b.info.includes('albariño');
            if (aBlanc && !bBlanc) return -1;
          }
          return Math.random() - 0.5;
        })
        .slice(0, 15);
    };

    const llistaVins = [...processarVins(premSnap), ...processarVins(econSnap)];

    // 2. PROMPT AMB REGLA D'OR
    const promptSystem = `Ets un Sommelier d'elit. Respon en ${idiomaReal}. 
    Escriu unes 300 paraules. Sigues molt descriptiu i expert.
    
    REGLA D'OR:
    - Tria EXACTAMENT 3 vins del JSON proporcionat.
    - Si l'usuari pregunta per una MARCA (ex: Cune), l'HAS de recomanar obligatòriament.
    - Si demana un PLAT (ex: percebes), justifica el maridatge amb els vins triats.
    - No t'inventis vins que no estiguin a la llista.
    
    FORMAT: <span class="nom-vi-destacat">NOM</span> i <span class="text-destacat-groc">DO</span>.
    JSON: {"explicacio": "...", "vins_triats": [{"nom": "...", "imatge": "..."}]}`;

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
          { role: 'user', content: `Vins reals: ${JSON.stringify(llistaVins)}. Consulta: ${pregunta}` }
        ],
        temperature: 0.2
      })
    });

    const data = await groqResponse.json();
    const contingut = JSON.parse(data.choices[0].message.content);
    
    // Reconstrucció final per garantir imatges correctes
    const vinsFinals = (contingut.vins_triats || []).slice(0, 3).map(vIA => {
      const real = llistaVins.find(r => r.nom === vIA.nom) || llistaVins[0];
      return { nom: real.nom, imatge: real.imatge };
    });

    res.status(200).json({ 
      resposta: `${contingut.explicacio} ||| ${JSON.stringify(vinsFinals)}` 
    });

  } catch (error) {
    res.status(200).json({ 
      resposta: `El sommelier està seleccionant la millor ampolla per a tu. ||| []` 
    });
  }
};
