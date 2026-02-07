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

    // 1. CONTROL D'IDIOMA
    const langMap = { 'ca': 'CATALÀ', 'es': 'CASTELLANO', 'en': 'ENGLISH', 'fr': 'FRANÇAIS' };
    const codi = (idioma || 'ca').toLowerCase().slice(0, 2);
    const idiomaReal = langMap[codi] || 'CATALÀ';

    // 2. OBTENCIÓ DE DADES AMB DIFERENCIACIÓ REAL
    // Busquem 40 vins cars (>30€) per a les 2 primeres opcions
    const premSnap = await db.collection('cercavins').where('preu', '>', 30).limit(40).get();
    // Busquem 40 vins econòmics (7-20€) per a la 3a opció
    const econSnap = await db.collection('cercavins').where('preu', '>=', 7).where('preu', '<=', 20).limit(40).get();

    const shuffle = (array) => array.sort(() => Math.random() - 0.5);

    let vinsPremium = [];
    premSnap.forEach(doc => {
      const d = doc.data();
      vinsPremium.push({ nom: d.nom, do: d.do, imatge: d.imatge, preu: d.preu, tipus: "ELIT" });
    });

    let vinsEcon = [];
    econSnap.forEach(doc => {
      const d = doc.data();
      vinsEcon.push({ nom: d.nom, do: d.do, imatge: d.imatge, preu: d.preu, tipus: "ASSEQUIBLE" });
    });

    const seleccioPremium = shuffle(vinsPremium).slice(0, 10);
    const seleccioEcon = shuffle(vinsEcon).slice(0, 10);

    // 3. PROMPT "AGRESSIU" PER FORÇAR IDIOMA I LONGITUD
    const promptSystem = `Ets un Sommelier de 3 estrelles Michelin. 
    REGLA 1: RESPON TOTALMENT EN ${idiomaReal}. ÉS OBLIGATORI.
    REGLA 2: L'explicació ha de ser LLARGA, DETALLADA i MAGISTRAL. Mínim 200 paraules.
    REGLA 3: Estructura la resposta així:
       - Una introducció poètica sobre el maridatge demanat.
       - Per a cada vi triat: un paràgraf sencer explicant el celler, el tast i per què és perfecte.
    REGLA 4: Tria 2 vins de la llista ELIT i 1 vi de la llista ASSEQUIBLE.
    REGLA 5: Usa <span class="nom-vi-destacat"> pel nom de cada vi.`;

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY?.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        response_format: { type: "json_object" },
        messages: [
          { role: 'system', content: promptSystem },
          { 
            role: 'user', 
            content: `IDIOMA: ${idiomaReal}. Pregunta: ${pregunta}. 
            Llista ELIT (tria 2): ${JSON.stringify(seleccioPremium)}. 
            Llista ASSEQUIBLE (tria 1): ${JSON.stringify(seleccioEcon)}.` 
          }
        ],
        temperature: 0.85
      })
    });

    const data = await groqResponse.json();
    if (!data.choices) throw new Error("Groq no respon");

    const contingut = JSON.parse(data.choices[0].message.content);
    
    // Enviem la resposta amb el separador per al teu frontend
    const respostaFinal = `${contingut.explicacio} ||| ${JSON.stringify(contingut.vins_triats)}`;
    res.status(200).json({ resposta: respostaFinal });

  } catch (error) {
    res.status(200).json({ 
      resposta: `Error: ${error.message}. Idioma sol·licitat: ${idioma} ||| []` 
    });
  }
};
