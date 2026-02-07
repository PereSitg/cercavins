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
    const { pregunta } = req.body;
    
    // 1. CERCA DE FOTO PER PARAULA CLAU (MOLT MÉS TOLERANT)
    let viPrincipal = null;
    if (pregunta) {
      const netejarText = (t) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const paraulesCerca = netejarText(pregunta).split(/\s+/).filter(p => p.length > 3);
      
      if (paraulesCerca.length > 0) {
        // Obtenim els vins per comprovar si el que l'usuari pregunta és un vi de la nostra BD
        const totsVins = await db.collection('cercavins').limit(1500).get();
        const trobat = totsVins.docs.find(doc => {
          const nomViDB = netejarText(doc.data().nom || "");
          // Mirem si alguna paraula de la pregunta coincideix amb el nom del vi
          return paraulesCerca.some(p => nomViDB.includes(p));
        });

        if (trobat) {
          const d = trobat.data();
          viPrincipal = { nom: d.nom, imatge: d.imatge };
        }
      }
    }

    // 2. SELECCIÓ DE VINS PER A RECOMANACIONS
    const [premSnap, econSnap] = await Promise.all([
      db.collection('cercavins').where('preu', '>', 35).limit(30).get(),
      db.collection('cercavins').where('preu', '>=', 7).where('preu', '<=', 18).limit(30).get()
    ]);

    const shuffle = (array) => array.sort(() => Math.random() - 0.5);
    const prepararVins = (snap) => {
      let l = [];
      snap.forEach(doc => {
        const d = doc.data();
        l.push({ nom: d.nom, imatge: d.imatge, do: d.do || "DO" });
      });
      return shuffle(l).slice(0, 10);
    };

    const llistaContext = prepararVins(premSnap).concat(prepararVins(econSnap));

    // 3. PROMPT DEL SOMMELIER
    const promptSystem = `Ets un Sommelier d'elit. Respon EXCLUSIVAMENT EN CATALÀ.
    
    NORMES:
    - Explicació MAGISTRAL, APASSIONADA i MOLT LLARGA (mínim 400 paraules).
    - Si pregunten per un vi, centra't en la seva història. Si és maridatge, explica l'harmonia.
    - Usa <span class="nom-vi-destacat"> pels noms dels vins.
    - Usa <span class="text-destacat-groc"> per DO, raïms i cellers (OBLIGATORI).
    - Tria 3 vins suggerits de la llista (2 Alta Gama, 1 Econòmic).
    
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
          { role: 'user', content: `Pregunta: ${pregunta}. Context vins: ${JSON.stringify(llistaContext)}` }
        ],
        temperature: 0.3
      })
    });

    const data = await groqResponse.json();
    const contingut = JSON.parse(data.choices[0].message.content);
    
    // 4. MUNTATGE FINAL DE FOTOS
    let vinsFinals = contingut.vins_triats || [];
    
    // Si hem trobat el vi de la pregunta a la BD, el forcem a la primera posició
    if (viPrincipal) {
      vinsFinals = [viPrincipal, ...vinsFinals.filter(v => v.nom !== viPrincipal.nom)].slice(0, 4);
    }

    const textFinal = contingut.explicacio || contingut.explicación || Object.values(contingut).find(v => typeof v === 'string');

    res.status(200).json({ resposta: `${textFinal} ||| ${JSON.stringify(vinsFinals)}` });

  } catch (error) {
    res.status(200).json({ resposta: `Error: ${error.message} ||| []` });
  }
};
