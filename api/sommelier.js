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
    
    // 1. DETECCIÓ DINÀMICA DE L'IDIOMA DEL DISPOSITIU
    const langMap = { 
      'ca': 'CATALÀ', 
      'es': 'CASTELLANO', 
      'en': 'ENGLISH', 
      'fr': 'FRANÇAIS' 
    };
    // Agafem el codi del sistema (ex: 'es-ES' -> 'es')
    const codiClient = (idioma || 'ca').toLowerCase().slice(0, 2);
    const idiomaReal = langMap[codiClient] || 'CASTELLANO'; // Per defecte castellà si el sistema ho demana

    // 2. CERCA DE LA FOTO DEL VI (LOGICA TOLERANT)
    let viPrincipal = null;
    if (pregunta) {
      const netejar = (t) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const paraules = netejar(pregunta).split(/\s+/).filter(p => p.length > 3);
      
      if (paraules.length > 0) {
        const totsVins = await db.collection('cercavins').limit(1500).get();
        const trobat = totsVins.docs.find(doc => {
          const nomDB = netejar(doc.data().nom || "");
          return paraules.some(p => nomDB.includes(p));
        });
        if (trobat) {
          const d = trobat.data();
          viPrincipal = { nom: d.nom, imatge: d.imatge, do: d.do || "DO" };
        }
      }
    }

    // 3. PREPARACIÓ DE VINS SENSE INVENTAR DADES
    const [premSnap, econSnap] = await Promise.all([
      db.collection('cercavins').where('preu', '>', 35).limit(20).get(),
      db.collection('cercavins').where('preu', '>=', 7).where('preu', '<=', 18).limit(20).get()
    ]);

    const prepararVins = (snap) => {
      return snap.docs.map(doc => {
        const d = doc.data();
        return { nom: d.nom, imatge: d.imatge, do_oficial: d.do || "DO" };
      }).sort(() => Math.random() - 0.5).slice(0, 10);
    };

    const llistaVins = prepararVins(premSnap).concat(prepararVins(econSnap));

    // 4. PROMPT ADAPTATIU PER IDIOMA I PRECISIÓ
    const promptSystem = `Eres un Sumiller de élite. 
    IDIOMA OBLIGATORIO: Responde exclusivamente en ${idiomaReal}.
    
    INSTRUCCIONES:
    - Explicación MAGISTRAL de más de 450 palabras. 
    - No inventes Denominaciones de Origen. Usa el campo "do_oficial".
    - El nombre del vino debe ir en: <span class="nom-vi-destacat">...</span>
    - La DO, uva o bodega en: <span class="text-destacat-groc">...</span>
    
    JSON FORMAT: {"explicacio": "...", "vins_triats": [{"nom": "...", "imatge": "..."}]}`;

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
          { role: 'user', content: `Consulta: ${pregunta}. Vinos: ${JSON.stringify(llistaVins)}` }
        ],
        temperature: 0.1
      })
    });

    const data = await groqResponse.json();
    const contingut = JSON.parse(data.choices[0].message.content);
    
    // 5. MUNTATGE FINAL
    let vinsFinals = contingut.vins_triats || [];
    if (viPrincipal) {
      vinsFinals = [viPrincipal, ...vinsFinals.filter(v => v.nom !== viPrincipal.nom)].slice(0, 4);
    }

    const textFinal = contingut.explicacio || Object.values(contingut).find(v => typeof v === 'string');

    res.status(200).json({ resposta: `${textFinal} ||| ${JSON.stringify(vinsFinals)}` });

  } catch (error) {
    res.status(200).json({ resposta: `Error: ${error.message} ||| []` });
  }
};
