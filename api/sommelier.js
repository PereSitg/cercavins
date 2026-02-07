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

    // DETERMINACIÓ DE L'IDIOMA (Ara incloent el Francès)
    const langMap = { 
      'ca': 'CATALÀ', 
      'es': 'CASTELLANO', 
      'en': 'ENGLISH', 
      'fr': 'FRANÇAIS' 
    };
    const codiIdioma = (idioma || 'ca').toLowerCase().slice(0, 2);
    const idiomaReal = langMap[codiIdioma] || 'CATALÀ';

    // 1. Grups de vins (2 Premium + 1 Econòmic)
    const assequiblesSnapshot = await db.collection('cercavins')
      .where('preu', '>=', 7)
      .where('preu', '<=', 20)
      .limit(10)
      .get();

    let grupEconòmic = [];
    assequiblesSnapshot.forEach(doc => {
      const d = doc.data();
      grupEconòmic.push({ nom: d.nom, do: d.do || "DO", preu: d.preu, imatge: d.imatge, categoria: "ECONÒMICA" });
    });

    const generalSnapshot = await db.collection('cercavins')
      .where('preu', '>', 20)
      .limit(15)
      .get();

    let grupPremium = [];
    generalSnapshot.forEach(doc => {
      const d = doc.data();
      grupPremium.push({ nom: d.nom, do: d.do || "DO", preu: d.preu, imatge: d.imatge, categoria: "PREMIUM" });
    });

    // 2. Crida a Groq
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
          {
            role: 'system',
            content: `STRICT RULE: YOU MUST RESPOND ENTIRELY IN ${idiomaReal}.
            Ets un sommelier expert.
            
            REGLA DE SELECCIÓ:
            - Tria 3 vins en total.
            - Els 2 primers vins han de ser del grup PREMIUM.
            - El 3er vi ha de ser del grup ECONÒMICA.
            
            REGLA D'ESTIL:
            - Escriu explicacions llargues, detallades i apassionades per a cada vi en ${idiomaReal}.
            - Usa <span class="nom-vi-destacat"> pel nom de cada vi.
            - No mencionis preus numèrics.
            
            JSON FORMAT: {"explicacio": "text en ${idiomaReal}", "vins_triats": [{"nom": "...", "imatge": "..."}]}`
          },
          {
            role: 'user',
            content: `Pregunta: ${pregunta}. Premium: ${JSON.stringify(grupPremium)}. Econòmics: ${JSON.stringify(grupEconòmic)}.`
          }
        ],
        temperature: 0.7
      })
    });

    const data = await groqResponse.json();
    if (!data.choices || !data.choices[0]) throw new Error("No response");

    const contingut = JSON.parse(data.choices[0].message.content);
    res.status(200).json({ resposta: `${contingut.explicacio} ||| ${JSON.stringify(contingut.vins_triats)}` });

  } catch (error) {
    res.status(200).json({ resposta: `Error: ${error.message} ||| []` });
  }
};
