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
    
    // 1. FORÇAR IDIOMA DEL DISPOSITIU
    const langMap = { 'ca': 'CATALÀ', 'es': 'CASTELLANO', 'en': 'ENGLISH', 'fr': 'FRANÇAIS' };
    const codi = (idioma || 'ca').toLowerCase().slice(0, 2);
    const idiomaReal = langMap[codi] || 'CATALÀ';

    // 2. CERCA DEL VI (Més tolerant amb majúscules/minúscules)
    let viPrincipal = null;
    const paraules = pregunta?.split(/\s+/) || [];
    const paraulaClau = paraules.find(p => p.length > 3);

    if (paraulaClau) {
      const term = paraulaClau.toLowerCase();
      const totsVins = await db.collection('cercavins').limit(500).get();
      const trobat = totsVins.docs.find(doc => doc.data().nom.toLowerCase().includes(term));
      
      if (trobat) {
        const d = trobat.data();
        viPrincipal = { nom: d.nom, imatge: d.imatge };
      }
    }

    // 3. RECUPERACIÓ DE RECOMANACIONS
    const [premSnap, econSnap] = await Promise.all([
      db.collection('cercavins').where('preu', '>', 35).limit(30).get(),
      db.collection('cercavins').where('preu', '>=', 7).where('preu', '<=', 18).limit(30).get()
    ]);

    const shuffle = (array) => array.sort(() => Math.random() - 0.5);
    const netejar = (snap) => {
      let l = [];
      snap.forEach(doc => {
        const d = doc.data();
        l.push({ nom: d.nom, do: d.do || "DO", imatge: d.imatge, preu: d.preu });
      });
      return shuffle(l).slice(0, 10);
    };

    // 4. PROMPT ULTRA-ESTRICTE AMB L'IDIOMA
    const promptSystem = `Responde OBLIGATORIAMENTE en el idioma: ${idiomaReal}.
    Tu nombre es Gemini Sommelier.
    
    INSTRUCCIONES:
    - Si el usuario pregunta por un vino concreto (como "${paraulaClau}"), explica su historia, bodega, notas de cata y maridaje de forma magistral y EXTENSA (400 palabras).
    - Usa <span class="nom-vi-destacat"> para nombres de vinos.
    - Usa <span class="text-destacat-groc"> para DO, uvas y bodegas.
    - Selecciona 3 vinos sugeridos de las listas (2 Alta Gama, 1 Económico).
    
    RESPUESTA EN FORMATO JSON: {"explicacio": "...", "vins_triats": [{"nom": "...", "imatge": "..."}]}`;

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
          { role: 'user', content: `Idioma: ${idiomaReal}. Pregunta del cliente: ${pregunta}. Vinos sugeridos: ${JSON.stringify(netejar(premSnap).concat(netejar(econSnap)))}` }
        ],
        temperature: 0.3
      })
    });

    const data = await groqResponse.json();
    const contingut = JSON.parse(data.choices[0].message.content);
    
    // Unifiquem: el vi que has preguntat SEMPRE surt el primer
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
