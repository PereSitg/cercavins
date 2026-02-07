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

    // 1. MAPA D'IDIOMES
    const langMap = { 'ca': 'CATALÀ', 'es': 'CASTELLANO', 'en': 'ENGLISH', 'fr': 'FRANÇAIS' };
    const codi = (idioma || 'ca').toLowerCase().slice(0, 2);
    const idiomaReal = langMap[codi] || 'CATALÀ';

    // 2. SELECCIÓ DE VINS (Diferenciació real de preus)
    const [premSnap, econSnap] = await Promise.all([
      db.collection('cercavins').where('preu', '>', 35).limit(30).get(),
      db.collection('cercavins').where('preu', '>=', 7).where('preu', '<=', 18).limit(30).get()
    ]);

    const shuffle = (array) => array.sort(() => Math.random() - 0.5);

    let vinsPremium = [];
    premSnap.forEach(doc => {
      const d = doc.data();
      vinsPremium.push({ nom: d.nom, do: d.do, imatge: d.imatge, preu: d.preu });
    });

    let vinsEcon = [];
    econSnap.forEach(doc => {
      const d = doc.data();
      vinsEcon.push({ nom: d.nom, do: d.do, imatge: d.imatge, preu: d.preu });
    });

    // Triem els vins per enviar (Barrejats)
    const seleccioPremium = shuffle(vinsPremium).slice(0, 8);
    const seleccioEcon = shuffle(vinsEcon).slice(0, 8);

    // 3. PROMPT ESTRUCTURAT PER EVITAR ERRORS
    const promptSystem = `Ets un Sommelier expert. 
    IMPORTANT: Respon SEMPRE en ${idiomaReal}. 
    
    INSTRUCCIONS:
    - Fes una introducció llarga i apassionada sobre el maridatge.
    - Tria 3 vins del context: els 2 primers de la llista "ALTA_GAMA" i el 3er de la llista "OPCIÓ_ASSEQUIBLE".
    - Per a CADA VI, escriu un paràgraf DETALLAT d'unes 50-80 paraules amb notes de tast i motiu del maridatge.
    - Usa <span class="nom-vi-destacat"> pel nom de cada vi.
    - Respon EXCLUSIVAMENT en format JSON.`;

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
            ALTA_GAMA: ${JSON.stringify(seleccioPremium)}. 
            OPCIÓ_ASSEQUIBLE: ${JSON.stringify(seleccioEcon)}.` 
          }
        ],
        temperature: 0.7
      })
    });

    const data = await groqResponse.json();
    
    // Verificació de seguretat
    if (!data.choices || data.choices.length === 0) {
      throw new Error("La IA no ha generat cap resposta.");
    }

    const contingut = JSON.parse(data.choices[0].message.content);
    
    // Si la IA ens dóna els camps buits o diferents, ens n'assegurem
    const explicacio = contingut.explicacio || contingut.description || "Ho sento, no he pogut generar l'explicació.";
    const vinsTriats = contingut.vins_triats || contingut.wines || [];

    const respostaFinal = `${explicacio} ||| ${JSON.stringify(vinsTriats)}`;
    res.status(200).json({ resposta: respostaFinal });

  } catch (error) {
    console.error("Error Sommelier:", error);
    res.status(200).json({ 
      resposta: `Error en el celler: ${error.message} ||| []` 
    });
  }
};
