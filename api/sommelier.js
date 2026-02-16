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

    // 1. Consultes a Firebase (pujem el límit per trobar millors coincidències)
    let refAlta = db.collection('cercavins').where('preu', '>', 35);
    let refEcon = db.collection('cercavins').where('preu', '>=', 7).where('preu', '<=', 18);

    const [premSnap, econSnap] = await Promise.all([
      refAlta.limit(100).get(),
      refEcon.limit(100).get()
    ]);

    // 2. Processament amb validació estricta d'imatge
    const processarVins = (snap) => {
      return snap.docs
        .map(doc => {
          const d = doc.data();
          return {
            nom: d.nom,
            do: d.do || "DO",
            imatge: d.imatge || "", // Agafem la URL real
            desc: `${d.nom} de la DO ${d.do}`
          };
        })
        .filter(v => {
          // NOMÉS vins amb imatge que no siguin de Vila Viniteca
          if (!v.imatge || v.imatge.length < 10 || v.do === "Vila Viniteca") return false;
          if (paraulesClau.length === 0) return true;
          return paraulesClau.some(clau => v.desc.toLowerCase().includes(clau));
        })
        .sort(() => Math.random() - 0.5)
        .slice(0, 15);
    };

    const llistaAlta = processarVins(premSnap);
    const llistaEcon = processarVins(econSnap);

    // 3. Prompt amb instruccions de longitud i imatges
    const promptSystem = `Ets un Sommelier d'elit. 
    IDIOMA: Respon en ${idiomaReal}.
    
    OBJECTIU: Escriu una recomanació MAGISTRAL d'unes 300 paraules. Explica el perquè del maridatge, les notes de tast i la zona geogràfica. Sigues molt descriptiu.
    
    FORMAT: 
    - Vi: <span class="nom-vi-destacat">NOM</span>
    - DO: <span class="text-destacat-groc">DO</span>
    
    IMPORTANT: Tria 3 vins del llistat proporcionat. Has d'usar la URL exacta de "imatge" que t'envio. No inventis noms de vins.
    
    Vins: ${JSON.stringify({ alta: llistaAlta, econ: llistaEcon })}

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
          { role: 'user', content: `Pregunta: ${pregunta}` }
        ],
        temperature: 0.6
      })
    });

    const data = await groqResponse.json();
    const contingut = JSON.parse(data.choices[0].message.content);
    
    res.status(200).json({ 
      resposta: `${contingut.explicacio} ||| ${JSON.stringify(contingut.vins_triats.slice(0, 3))}` 
    });

  } catch (error) {
    res.status(200).json({ resposta: `Error en la selecció. ||| []` });
  }
};
