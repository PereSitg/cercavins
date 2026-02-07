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

    const langMap = { 'ca': 'CATALÀ', 'es': 'CASTELLANO', 'en': 'ENGLISH', 'fr': 'FRANÇAIS' };
    const codi = (idioma || 'ca').toLowerCase().slice(0, 2);
    const idiomaReal = langMap[codi] || 'CATALÀ';

    // 1. RECUPERACIÓ DE DADES AMB FILTRE DE SEGURETAT
    const [premSnap, econSnap] = await Promise.all([
      db.collection('cercavins').where('preu', '>', 35).limit(40).get(),
      db.collection('cercavins').where('preu', '>=', 7).where('preu', '<=', 18).limit(40).get()
    ]);

    const shuffle = (array) => array.sort(() => Math.random() - 0.5);

    const netejarVins = (snap) => {
      let llista = [];
      snap.forEach(doc => {
        const d = doc.data();
        // Intentem deduir si és blanc/escumós pel nom o DO per ajudar la IA
        llista.push({ nom: d.nom, do: d.do || "DO", imatge: d.imatge, preu: d.preu });
      });
      return shuffle(llista).slice(0, 15);
    };

    const seleccioPremium = netejarVins(premSnap);
    const seleccioEcon = netejarVins(econSnap);

    // 2. EL PROMPT MÉS ESTRICTE FINS ARA
    const promptSystem = `Ets un Sommelier d'elit. Respon EXCLUSIVAMENT en ${idiomaReal}.
    
    NORMES CRÍTIQUES:
    1. Si l'usuari pregunta per MARISC o PEIX, selecciona només vins BLANCS o ESCUMOSOS de les llistes. PROHIBIT triar vins negres (Tinto/Rouge).
    2. L'explicació ha de ser LLARGA i MAGISTRAL (mínim 300 paraules).
    3. Tria 2 vins de ALTA_GAMA i 1 de OPCIÓ_ASSEQUIBLE.
    4. Per a cada vi, descriu el celler, la varietat i per què el maridatge és perfecte.
    5. Usa <span class="nom-vi-destacat"> pel nom del vi.
    
    RESPON NOMÉS AMB AQUEST JSON: {"explicacio": "...", "vins_triats": [{"nom": "...", "imatge": "..."}]}`;

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
          { role: 'user', content: `Idioma: ${idiomaReal}. Pregunta: ${pregunta}. ALTA_GAMA: ${JSON.stringify(seleccioPremium)}. OPCIÓ_ASSEQUIBLE: ${JSON.stringify(seleccioEcon)}.` }
        ],
        temperature: 0.4 // Baixem a 0.4 per garantir que obeeixi i no s'inventi negres
      })
    });

    const data = await groqResponse.json();

    // Validació anti-error 'reading 0'
    if (!data?.choices?.[0]?.message?.content) {
      throw new Error("L'API de Groq no ha tornat dades vàlides.");
    }

    const contingut = JSON.parse(data.choices[0].message.content);
    
    // Assegurem que agafem les claus correctament
    const textFinal = contingut.explicacio || contingut.explicación || contingut.description;
    const vinsFinals = contingut.vins_triats || contingut.vins || [];

    res.status(200).json({ resposta: `${textFinal} ||| ${JSON.stringify(vinsFinals)}` });

  } catch (error) {
    console.error("Error Sommelier:", error);
    res.status(200).json({ 
      resposta: `Ho sento Pere, el celler està tancat per manteniment: ${error.message} ||| []` 
    });
  }
};
