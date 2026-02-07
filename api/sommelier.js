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

    // 1. CERCA "TODO TERRENO" DE LA FOTO (Sense accents i parcial)
    let viPrincipal = null;
    if (pregunta) {
      const netejarText = (t) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const paraulesCerca = netejarText(pregunta).split(/\s+/).filter(p => p.length > 3);
      
      if (paraulesCerca.length > 0) {
        const totsVins = await db.collection('cercavins').limit(1500).get();
        
        // Busquem el vi que contingui la paraula clau (ex: "murrieta") ignorant accents
        const trobat = totsVins.docs.find(doc => {
          const nomViDB = netejarText(doc.data().nom || "");
          return paraulesCerca.some(p => nomViDB.includes(p));
        });

        if (trobat) {
          const d = trobat.data();
          viPrincipal = { nom: d.nom, imatge: d.imatge };
        }
      }
    }

    // 2. RECOLLIDA DE SUGGERIMENTS
    const [premSnap, econSnap] = await Promise.all([
      db.collection('cercavins').where('preu', '>', 35).limit(20).get(),
      db.collection('cercavins').where('preu', '>=', 7).where('preu', '<=', 18).limit(20).get()
    ]);

    const shuffle = (array) => array.sort(() => Math.random() - 0.5);
    const prepararVins = (snap) => {
      let l = [];
      snap.forEach(doc => {
        const d = doc.data();
        l.push({ nom: d.nom, imatge: d.imatge });
      });
      return shuffle(l).slice(0, 10);
    };

    const llistaContext = prepararVins(premSnap).concat(prepararVins(econSnap));

    // 3. PROMPT ESTRICTE
    const promptSystem = `Respon OBLIGATORIAMENT en ${idiomaReal}. Ets un Sommelier d'elit.
    NORMES:
    - Si pregunten per un vi: explica història, celler i notes de tast (Mínim 350 paraules).
    - Usa <span class="nom-vi-destacat"> pel nom del vi.
    - Usa <span class="text-destacat-groc"> per DO, raïms i cellers.
    - Tria 3 suggeriments coherents de la llista.
    JSON: {"explicacio": "...", "vins_triats": [{"nom": "...", "imatge": "..."}]}`;

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
          { role: 'user', content: `Pregunta: ${pregunta}. Vins: ${JSON.stringify(llistaContext)}` }
        ],
        temperature: 0.3
      })
    });

    const data = await groqResponse.json();
    const contingut = JSON.parse(data.choices[0].message.content);
    
    // 4. EL TRUC FINAL: Punxem la foto trobada a Firestore la primera
    let vinsFinals = contingut.vins_triats || [];
    if (viPrincipal) {
      vinsFinals = [viPrincipal, ...vinsFinals.filter(v => v.nom !== viPrincipal.nom)].slice(0, 4);
    }

    const textFinal = contingut.explicacio || contingut.explicación || Object.values(contingut).find(v => typeof v === 'string');

    res.status(200).json({ resposta: `${textFinal} ||| ${JSON.stringify(vinsFinals)}` });

  } catch (error) {
    res.status(200).json({ resposta: `Error: ${error.message} ||| []` });
  }
};
