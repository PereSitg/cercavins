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

    // 1. BUSCAR EL VI DE LA PREGUNTA (Millorat amb normalització)
    let viPrincipal = null;
    const paraules = pregunta.split(/\s+/).filter(p => p.length > 3);
    
    if (paraules.length > 0) {
      // Intentem buscar el vi (Cune, Vega Sicilia, etc.)
      const nomCerca = paraules[0].charAt(0).toUpperCase() + paraules[0].slice(1).toLowerCase();
      const cercaSnap = await db.collection('cercavins')
        .where('nom', '>=', nomCerca)
        .where('nom', '<=', nomCerca + '\uf8ff')
        .limit(1)
        .get();
      
      if (!cercaSnap.empty) {
        const d = cercaSnap.docs[0].data();
        viPrincipal = { nom: d.nom, imatge: d.imatge };
      }
    }

    // 2. RECUPERACIÓ DE VINS PER A RECOMANAR
    const [premSnap, econSnap] = await Promise.all([
      db.collection('cercavins').where('preu', '>', 35).limit(50).get(),
      db.collection('cercavins').where('preu', '>=', 7).where('preu', '<=', 18).limit(50).get()
    ]);

    const shuffle = (array) => array.sort(() => Math.random() - 0.5);

    const netejarVins = (snap) => {
      let llista = [];
      snap.forEach(doc => {
        const d = doc.data();
        llista.push({ nom: d.nom, do: d.do || "DO", imatge: d.imatge, preu: d.preu });
      });
      return shuffle(llista).slice(0, 15);
    };

    const seleccioPremium = netejarVins(premSnap);
    const seleccioEcon = netejarVins(econSnap);

    // 3. PROMPT AMB INSTRUCCIONS DE SEPARACIÓ ÚNIQUES
    const promptSystem = `Eres un Sumiller experto. Responde OBLIGATORIAMENTE en ${idiomaReal}.
    
    ESTILO VISUAL:
    - Nombres de vinos: <span class="nom-vi-destacat">Nombre</span>.
    - DO, Uvas y Bodegas: <span class="text-destacat-groc">Dato</span>.
    
    CONTENIDO:
    - Si preguntan por marisco/pescado, selecciona BLANCOS/ESPUMOSOS. PROHIBIDO tintos.
    - Explicación MAGISTRAL y MUY LARGA (mínimo 300 palabras).
    - Elige 2 vinos de ALTA_GAMA y 1 de OPCIÓN_ASSEQUIBLE.
    
    IMPORTANTE: Responde con este JSON EXACTO:
    {"explicacion": "Texto largo aquí...", "vins_triats": [{"nom": "...", "imatge": "..."}]}`;

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
          { role: 'user', content: `Idioma: ${idiomaReal}. Pregunta: ${pregunta}. ALTA_GAMA: ${JSON.stringify(seleccioPremium)}. OPCIÓN_ASSEQUIBLE: ${JSON.stringify(seleccioEcon)}.` }
        ],
        temperature: 0.3 // Més baix per evitar errors de format
      })
    });

    const data = await groqResponse.json();
    const contingut = JSON.parse(data.choices[0].message.content);
    
    // Ajuntem vi preguntat + recomanacions
    let vinsFinals = contingut.vins_triats || [];
    if (viPrincipal) {
      // Evitem duplicats si la IA ja l'ha triat
      if (!vinsFinals.some(v => v.nom === viPrincipal.nom)) {
        vinsFinals.unshift(viPrincipal);
      }
    }

    const textFinal = contingut.explicacio || contingut.explicación || contingut.explanation;

    // EL SEPARADOR CRÍTIC: El text i després el JSON de vins
    res.status(200).json({ resposta: `${textFinal} ||| ${JSON.stringify(vinsFinals)}` });

  } catch (error) {
    console.error(error);
    res.status(200).json({ resposta: `Error: ${error.message} ||| []` });
  }
};
