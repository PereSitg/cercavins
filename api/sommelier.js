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
    const codiClient = (idioma || 'ca').toLowerCase().slice(0, 2);
    const idiomaReal = langMap[codiClient] || 'CATALÀ';

    const paraulesClau = p.split(/[ ,.!?]+/).filter(w => w.length > 3);

    // 1. Busquem més vins (límit 100) per garantir que en trobem amb imatge
    const [premSnap, econSnap] = await Promise.all([
      db.collection('cercavins').where('preu', '>', 35).limit(100).get(),
      db.collection('cercavins').where('preu', '>=', 7).where('preu', '<=', 18).limit(100).get()
    ]);

    // 2. FILTRATGE CRÍTIC D'IMATGES
    const processarVins = (snap) => {
      return snap.docs
        .map(doc => {
          const d = doc.data();
          return {
            nom: d.nom,
            do: d.do || "DO",
            imatge: d.imatge || "", // Agafem la URL
            desc: `${d.nom} ${d.do} ${d.tipus || ''} ${d.varietat || ''}`.toLowerCase()
          };
        })
        .filter(v => {
          // REGLA D'OR: Si no té imatge vàlida o és Vila Viniteca, fora.
          const teImatge = v.imatge && v.imatge.startsWith('http');
          if (!teImatge || v.do === "Vila Viniteca") return false;
          
          if (paraulesClau.length === 0) return true;
          return paraulesClau.some(clau => v.desc.includes(clau));
        })
        .sort(() => Math.random() - 0.5)
        .slice(0, 15);
    };

    const llistaAlta = processarVins(premSnap);
    const llistaEcon = processarVins(econSnap);

    // 3. PROMPT ANTI-INVENCIÓ
    const promptSystem = `Ets un Sommelier d'elit. 
    IDIOMA: Respon en ${idiomaReal}.
    
    INSTRUCCIONS:
    - Escriu una recomanació MAGISTRAL de 300 paraules. Sigues expert i apassionat.
    - REGLA D'OR: Només pots triar vins del llistat JSON que t'envio.
    - IMATGES: Has de copiar la URL exacta del camp "imatge". No inventis res.
    - FORMAT: Vi en <span class="nom-vi-destacat"> i DO en <span class="text-destacat-groc">.

    VINS DISPONIBLES (TRIATS DE BBDD):
    ${JSON.stringify({ alta: llistaAlta, econ: llistaEcon })}

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
          { role: 'user', content: `Consulta: ${pregunta}` }
        ],
        temperature: 0.5
      })
    });

    const data = await groqResponse.json();
    const contingut = JSON.parse(data.choices[0].message.content);
    
    // Retornem els vins triats amb la seva imatge real de BBDD
    res.status(200).json({ 
      resposta: `${contingut.explicacio} ||| ${JSON.stringify(contingut.vins_triats.slice(0, 3))}` 
    });

  } catch (error) {
    res.status(200).json({ resposta: `Error en el tast. ||| []` });
  }
};
