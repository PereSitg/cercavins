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
    
    // 1. Idioma
    const langMap = { 'ca': 'CATALÀ', 'es': 'CASTELLANO', 'en': 'ENGLISH', 'fr': 'FRANÇAIS' };
    const codiClient = (idioma || 'ca').toLowerCase().slice(0, 2);
    const idiomaReal = langMap[codiClient] || 'CATALÀ';

    // 2. Extracció de paraules clau per al filtre intel·ligent
    const paraulesClau = p.split(/[ ,.!?]+/).filter(w => w.length > 3);

    // 3. Recuperació de vins (Pujem el límit per tenir més varietat global)
    const [premSnap, econSnap] = await Promise.all([
      db.collection('cercavins').where('preu', '>', 35).limit(60).get(),
      db.collection('cercavins').where('preu', '>=', 7).where('preu', '<=', 18).limit(60).get()
    ]);

    const filtrarVins = (snap) => {
      return snap.docs
        .map(doc => {
          const d = doc.data();
          return { 
            nom: d.nom, 
            imatge: d.imatge, 
            do: d.do || "DO",
            varietat: d.varietat || "",
            tipus: d.tipus || "",
            // Creem una cadena de text perquè la IA pugui "buscar" dins del vi
            info: `${d.nom} ${d.do} ${d.varietat} ${d.tipus}`.toLowerCase()
          };
        })
        .filter(v => {
          if (!v.imatge || v.do === "Vila Viniteca" || v.do === "Desconeguda") return false;
          
          // Si l'usuari demana percebes (marisc), busquem blancs o paraules clau
          if (paraulesClau.length === 0) return true;
          return paraulesClau.some(clau => v.info.includes(clau)) || (p.includes('percebe') && v.tipus === 'Blanc');
        })
        .sort(() => Math.random() - 0.5)
        .slice(0, 15);
    };

    const llistaAlta = filtrarVins(premSnap);
    const llistaEcon = filtrarVins(econSnap);

    // 4. PROMPT REFORÇAT PER A TEXT LLARG I IMATGES REALS
    const promptSystem = `Ets un Sommelier d'elit. Respon en ${idiomaReal}. 
    
    INSTRUCCIONS DE CONTINGUT:
    - Escriu una recomanació MAGISTRAL i APASSIONADA d'unes 300 paraules.
    - Explica detalladament el maridatge (per què aquest vi va bé amb el plat).
    - Parla de les notes de tast (fruita, acidesa, fusta...).
    
    REGLA D'OR DE FORMAT:
    - Nom del vi: <span class="nom-vi-destacat">NOM</span>.
    - DO o Regió: <span class="text-destacat-groc">DO</span>.
    
    IMPORTANTÍSSIM PER A LES IMATGES:
    - Tria exactament 3 vins del JSON (2 alta gama, 1 econòmic).
    - HAS D'USAR LA URL D'IMATGE EXACTA QUE APLEGA AL JSON. No inventis noms genèrics.
    
    JSON OBLIGATORI: {"explicacio": "Text llarg amb HTML...", "vins_triats": [{"nom": "...", "imatge": "..."}]}`;

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
        temperature: 0.5
      })
    });

    const data = await groqResponse.json();
    if (data.error) throw new Error(data.error.message);

    const contingut = JSON.parse(data.choices[0].message.content);
    
    const vinsFinals = (contingut.vins_triats || []).slice(0, 3);
    const textFinal = contingut.explicacio;

    res.status(200).json({ 
      resposta: `${textFinal} ||| ${JSON.stringify(vinsFinals)}` 
    });

  } catch (error) {
    console.error("ERROR:", error.message);
    res.status(200).json({ 
      resposta: `Ho sento, el sommelier està seleccionant el millor maridatge. ||| []` 
    });
  }
};
