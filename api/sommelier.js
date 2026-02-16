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

    // Paraules clau per al maridatge
    const paraulesClau = p.split(/[ ,.!?]+/).filter(w => w.length > 3);

    // 1. Recuperació de vins amb un límit més alt per poder filtrar millor
    const [premSnap, econSnap] = await Promise.all([
      db.collection('cercavins').where('preu', '>', 35).limit(40).get(),
      db.collection('cercavins').where('preu', '>=', 7).where('preu', '<=', 18).limit(40).get()
    ]);

    const filtrarVins = (snap) => {
      return snap.docs
        .map(doc => {
          const d = doc.data();
          return { 
            nom: d.nom, 
            imatge: d.imatge || "", 
            do_real: d.do || "DO",
            cerca: `${d.nom} ${d.do} ${d.varietat || ''} ${d.tipus || ''}`.toLowerCase()
          };
        })
        .filter(v => {
          // REGLA D'OR: Ha de tenir imatge real i no ser un logo genèric
          const teImatgeReal = v.imatge.startsWith('http');
          const noEsLogo = !v.nom.includes("Vila Viniteca") && v.do_real !== "Vila Viniteca";
          if (!teImatgeReal || !noEsLogo) return false;

          // Si demanem maridatge de marisc, prioritzem blancs
          if (p.includes('percebe') || p.includes('marisc')) {
             return v.cerca.includes('blanc');
          }
          return true;
        })
        .sort(() => Math.random() - 0.5)
        .slice(0, 10); 
    };

    const llistaAlta = filtrarVins(premSnap);
    const llistaEcon = filtrarVins(econSnap);

    // 2. Prompt per garantir 3 vins i text llarg
    const promptSystem = `Ets un Sommelier d'elit. Respon en ${idiomaReal}. 
    Escriu una recomanació de unes 300 paraules. Sigues molt descriptiu.
    
    REGLA D'OR:
    - Tria EXACTAMENT 3 vins de la llista (2 alta gama, 1 econòmic).
    - Usa la URL de la "imatge" tal qual, sense canviar ni una lletra.
    - Format HTML: <span class="nom-vi-destacat">NOM</span> i <span class="text-destacat-groc">DO</span>.

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
          { role: 'user', content: `Consulta: ${pregunta}. Vins reals amb foto: ${JSON.stringify({alta: llistaAlta, econ: llistaEcon})}` }
        ],
        temperature: 0.2 // Baixem la temperatura per a que sigui més precís amb les dades
      })
    });

    const data = await groqResponse.json();
    const contingut = JSON.parse(data.choices[0].message.content);
    
    res.status(200).json({ 
      resposta: `${contingut.explicacio} ||| ${JSON.stringify(contingut.vins_triats.slice(0, 3))}` 
    });

  } catch (error) {
    res.status(200).json({ 
      resposta: `El sommelier està seleccionant el millor maridatge. ||| []` 
    });
  }
};
