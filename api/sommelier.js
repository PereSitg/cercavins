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

    // Paraules clau per buscar (raïm, DO, nom del vi)
    const paraulesClau = p.split(/[ ,.!?]+/).filter(w => w.length > 2);

    // 1. Recuperació de vins (Límit de 150 per garantir que trobem el vi que busques)
    const [premSnap, econSnap] = await Promise.all([
      db.collection('cercavins').where('preu', '>', 35).limit(150).get(),
      db.collection('cercavins').where('preu', '>=', 7).where('preu', '<=', 18).limit(150).get()
    ]);

    const filtrarVins = (snap) => {
      return snap.docs
        .map(doc => {
          const d = doc.data();
          return { 
            nom: d.nom || "", 
            imatge: d.imatge || "", 
            do_real: d.do || "DO",
            cerca: `${d.nom} ${d.do} ${d.varietat || ''} ${d.tipus || ''}`.toLowerCase()
          };
        })
        .filter(v => {
          // REGLA D'OR: Imatge real i no ser logo genèric
          const teImatgeReal = v.imatge.startsWith('http') && !v.imatge.includes('viniteca');
          if (!teImatgeReal) return false;
          return true;
        })
        .sort((a, b) => {
          // PRIORITAT: Si l'usuari pregunta per un vi o DO concreta, el posem primer
          const aEnPregunta = paraulesClau.some(clau => a.cerca.includes(clau));
          const bEnPregunta = paraulesClau.some(clau => b.cerca.includes(clau));
          if (aEnPregunta && !bEnPregunta) return -1;
          if (!aEnPregunta && bEnPregunta) return 1;
          return Math.random() - 0.5;
        })
        .slice(0, 15); // Passem 15 candidats a la IA
    };

    const llistaAlta = filtrarVins(premSnap);
    const llistaEcon = filtrarVins(econSnap);

    // 2. Prompt per garantir 3 vins, text llarg i precisió en el maridatge
    const promptSystem = `Ets un Sommelier d'elit. Respon en ${idiomaReal}. 
    INSTRUCCIÓ DE TEXT: Escriu unes 300 paraules detallades. Sigues expert i apassionat.
    
    REGLA DE SELECCIÓ:
    - Si l'usuari pregunta per un vi que està a la llista, l'HAS de triar.
    - Si l'usuari demana un maridatge (ex: percebes), tria els vins que millor hi basin.
    - Tria EXACTAMENT 3 vins (2 de gamma alta i 1 d'econòmic).
    
    REGLA DE FORMAT:
    - Usa la URL de la "imatge" tal qual, sense canviar ni una lletra.
    - Format HTML: <span class="nom-vi-destacat">NOM</span> i <span class="text-destacat-groc">DO</span>.

    JSON OBLIGATORI: {"explicacio": "Text llarg HTML...", "vins_triats": [{"nom": "...", "imatge": "..."}]}`;

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
          { role: 'user', content: `Consulta: ${pregunta}. Vins disponibles: ${JSON.stringify({alta: llistaAlta, econ: llistaEcon})}` }
        ],
        temperature: 0.3
      })
    });

    const data = await groqResponse.json();
    const contingut = JSON.parse(data.choices[0].message.content);
    
    res.status(200).json({ 
      resposta: `${contingut.explicacio} ||| ${JSON.stringify(contingut.vins_triats.slice(0, 3))}` 
    });

  } catch (error) {
    res.status(200).json({ 
      resposta: `El sommelier està seleccionant el millor maridatge per a tu. ||| []` 
    });
  }
};
