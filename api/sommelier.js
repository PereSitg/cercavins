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

    // 2. Extracció de paraules clau (raïm, països, regions)
    const paraulesClau = p.split(/[ ,.!?]+/).filter(w => w.length > 3);

    // 3. Recuperació massiva per tenir on triar (Límit 50 per categoria)
    const [premSnap, econSnap] = await Promise.all([
      db.collection('cercavins').where('preu', '>', 35).limit(50).get(),
      db.collection('cercavins').where('preu', '>=', 7).where('preu', '<=', 18).limit(50).get()
    ]);

    const filtrarVins = (snap) => {
      return snap.docs
        .map(doc => {
          const d = doc.data();
          return { 
            nom: d.nom, 
            imatge: d.imatge, 
            do_real: d.do || "DO",
            varietat: d.varietat || "",
            tipus: d.tipus || ""
          };
        })
        .filter(v => {
          // Seguretat: Ha de tenir imatge i no ser Vila Viniteca
          if (!v.imatge || v.do_real === "Vila Viniteca") return false;
          
          // Filtre intel·ligent: si l'usuari busca algo específic, mirem si el vi ho té
          if (paraulesClau.length === 0) return true;
          const textVi = `${v.nom} ${v.do_real} ${v.varietat} ${v.tipus}`.toLowerCase();
          return paraulesClau.some(clau => textVi.includes(clau));
        })
        .sort(() => Math.random() - 0.5)
        .slice(0, 15); // Passar-ne 15 a la IA és el punt ideal
    };

    const llistaAlta = filtrarVins(premSnap);
    const llistaEcon = filtrarVins(econSnap);

    // 4. PROMPT (Mantenint l'estructura que t'ha funcionat)
    const promptSystem = `Ets un Sommelier d'elit. Respon en ${idiomaReal}. 
    Escriu una recomanació MAGISTRAL de unes 300 paraules. Sigues molt descriptiu i expert.
    
    REGLA D'OR DE FORMAT:
    - Cada vegada que mencionis un VI, usa: <span class="nom-vi-destacat">NOM DEL VI</span>.
    - Cada vegada que mencionis una DO, usa: <span class="text-destacat-groc">NOM DO</span>.

    IMPORTANT: Tria exactament 3 vins del JSON i usa la seva "imatge" tal qual apareix. No inventis res.
    JSON OBLIGATORI: {"explicacio": "Text llarg amb els span HTML...", "vins_triats": [{"nom": "...", "imatge": "..."}]}`;

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
        temperature: 0.4
      })
    });

    const data = await groqResponse.json();
    if (data.error) throw new Error(data.error.message);

    const contingut = JSON.parse(data.choices[0].message.content);
    
    // 5. Resposta Final
    const vinsFinals = (contingut.vins_triats || []).slice(0, 3);
    const textFinal = contingut.explicacio || "Aquí tens la meva selecció...";

    res.status(200).json({ 
      resposta: `${textFinal} ||| ${JSON.stringify(vinsFinals)}` 
    });

  } catch (error) {
    console.error("ERROR:", error.message);
    res.status(200).json({ 
      resposta: `Ho sento, el sommelier està ocupat. (Error: ${error.message}) ||| []` 
    });
  }
};
