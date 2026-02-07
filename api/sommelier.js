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

    // 1. FORÇAR IDIOMA
    const langMap = { 'ca': 'CATALÀ', 'es': 'CASTELLANO', 'en': 'ENGLISH', 'fr': 'FRANÇAIS' };
    const codi = (idioma || 'ca').toLowerCase().slice(0, 2);
    const idiomaReal = langMap[codi] || 'CATALÀ';

    // 2. BUSCAR VINS AMB ORDRE ALEATORI (Usem un truc de Firebase)
    const randomSeed = Math.random().toString(36).substring(7);

    // Agafem 50 vins econòmics (7-20€)
    const econSnapshot = await db.collection('cercavins')
      .where('preu', '>=', 7)
      .where('preu', '<=', 20)
      .limit(50)
      .get();

    // Agafem 50 vins premium (>25€ per marcar distància)
    const premSnapshot = await db.collection('cercavins')
      .where('preu', '>', 25)
      .limit(50)
      .get();

    const barrejar = (arr) => arr.sort(() => Math.random() - 0.5);

    let llistaEcon = [];
    econSnapshot.forEach(doc => {
      const d = doc.data();
      llistaEcon.push({ nom: d.nom, do: d.do || "DO", imatge: d.imatge, preu: d.preu, tipus: "OPORTUNITAT_ECONOMICA" });
    });

    let llistaPrem = [];
    premSnapshot.forEach(doc => {
      const d = doc.data();
      llistaPrem.push({ nom: d.nom, do: d.do || "DO", imatge: d.imatge, preu: d.preu, tipus: "JOIA_DEL_CELLER" });
    });

    // Seleccionem mostres aleatòries per no repetir sempre el mateix
    const seleccioEcon = barrejar(llistaEcon).slice(0, 10);
    const seleccioPrem = barrejar(llistaPrem).slice(0, 10);

    // 3. CRIDA A LA IA AMB ORDRES MOLT STRICTES
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
            content: `CRITICAL: You must write the entire response in ${idiomaReal}. 
            
            Ets un sommelier d'alta gamma. La teva tasca:
            1. Escriu una introducció segons la pregunta de l'usuari en ${idiomaReal}.
            2. TRIA EXACTAMENT 3 VINS:
               - El Vi 1 i el Vi 2 HAN DE SER de la llista "JOIA_DEL_CELLER".
               - El Vi 3 HA DE SER de la llista "OPORTUNITAT_ECONOMICA".
            3. Per a cada vi, redacta un paràgraf ric, extens i exclusiu. Explica notes de tast i maridatge.
            4. FORMAT: Usa <span class="nom-vi-destacat"> pel nom del vi. No posis preus.
            
            JSON structure: {"explicacio": "text en ${idiomaReal}", "vins_triats": [{"nom": "...", "imatge": "..."}]}`
          },
          {
            role: 'user',
            content: `IDIOMA: ${idiomaReal}. Pregunta: ${pregunta}. 
            Llista JOIA_DEL_CELLER: ${JSON.stringify(seleccioPrem)}. 
            Llista OPORTUNITAT_ECONOMICA: ${JSON.stringify(seleccioEcon)}.`
          }
        ],
        temperature: 0.9 // Més alta per forçar varietat
      })
    });

    const data = await groqResponse.json();
    const contingut = JSON.parse(data.choices[0].message.content);
    res.status(200).json({ resposta: `${contingut.explicacio} ||| ${JSON.stringify(contingut.vins_triats)}` });

  } catch (error) {
    res.status(200).json({ resposta: `Error: ${error.message} ||| []` });
  }
};
