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

    // 1. MAPA D'IDIOMES (Inclou el francès)
    const langMap = { 'ca': 'CATALÀ', 'es': 'CASTELLANO', 'en': 'ENGLISH', 'fr': 'FRANÇAIS' };
    const codi = (idioma || 'ca').toLowerCase().slice(0, 2);
    const idiomaReal = langMap[codi] || 'CATALÀ';

    // 2. SELECCIÓ DE VINS AMB FILTRES REALS
    const [premSnap, econSnap] = await Promise.all([
      db.collection('cercavins').where('preu', '>', 35).limit(40).get(),
      db.collection('cercavins').where('preu', '>=', 7).where('preu', '<=', 18).limit(40).get()
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

    // Seleccionem 10 de cada per enviar a la IA (barrejats)
    const seleccioPremium = shuffle(vinsPremium).slice(0, 10);
    const seleccioEcon = shuffle(vinsEcon).slice(0, 10);

    // 3. PROMPT ULTRA-ESTRICTE
    const promptSystem = `Ets un Sommelier expert. 
    INSTRUCCIÓ OBLIGATÒRIA: RESPON SEMPRE EN ${idiomaReal}.
    
    TASCA:
    1. Escriu una introducció i una explicació DETALLADA i EXTENSA sobre el maridatge (mínim 3 paràgrafs grans).
    2. Tria 3 vins: els 2 primers de ALTA_GAMA i el 3er de OPCIÓ_ASSEQUIBLE.
    3. Descriu cada vi amb passió, notes de tast i motiu de la tria.
    4. Usa <span class="nom-vi-destacat"> pel nom del vi.
    
    FORMAT JSON: {"explicacio": "aquí tot el text llarg en ${idiomaReal}", "vins_triats": [{"nom": "...", "imatge": "..."}]}`;

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
          { role: 'user', content: `IDIOMA: ${idiomaReal}. Pregunta: ${pregunta}. ALTA_GAMA: ${JSON.stringify(seleccioPremium)}. OPCIÓ_ASSEQUIBLE: ${JSON.stringify(seleccioEcon)}.` }
        ],
        temperature: 0.8
      })
    });

    const data = await groqResponse.json();
    const rawContent = data.choices[0].message.content;
    const contingut = JSON.parse(rawContent);
    
    // SISTEMA ANTIBLOQUEIG: Busquem el text encara que la IA canviï el nom de la clau
    const explicacioFinal = contingut.explicacio || contingut.explicación || contingut.explanation || contingut.description || "Error de format";
    const vinsFinals = contingut.vins_triats || contingut.vins || contingut.wines || [];

    res.status(200).json({ resposta: `${explicacioFinal} ||| ${JSON.stringify(vinsFinals)}` });

  } catch (error) {
    res.status(200).json({ resposta: `Error en el celler: ${error.message} ||| []` });
  }
};
