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

    // 1. CERCA DEL VI PRINCIPAL (Evitar undefined)
    let viPrincipal = null;
    if (pregunta && pregunta.trim().length > 0) {
      const paraules = pregunta.split(/\s+/).filter(p => p.length > 3);
      if (paraules.length > 0) {
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
    }

    // 2. RECUPERACIÓ DE RECOMANACIONS
    const [premSnap, econSnap] = await Promise.all([
      db.collection('cercavins').where('preu', '>', 35).limit(40).get(),
      db.collection('cercavins').where('preu', '>=', 7).where('preu', '<=', 18).limit(40).get()
    ]);

    const shuffle = (array) => array.sort(() => Math.random() - 0.5);

    const processarVins = (snap) => {
      let llista = [];
      snap.forEach(doc => {
        const d = doc.data();
        llista.push({ nom: d.nom, do: d.do || "DO", imatge: d.imatge, preu: d.preu });
      });
      return shuffle(llista).slice(0, 15);
    };

    const seleccioPremium = processarVins(premSnap);
    const seleccioEcon = processarVins(econSnap);

    // 3. PROMPT PROFESSIONAL AMB MARCADORS DE COLOR
    const promptSystem = `Eres un Sumiller experto. Responde OBLIGATORIAMENTE en ${idiomaReal}.
    
    ESTILO VISUAL:
    - Nombres de vinos: <span class="nom-vi-destacat">...</span>
    - DO, Uvas y Bodegas: <span class="text-destacat-groc">...</span>
    
    CONTENIDO:
    - Si preguntan por marisco/pescado: elige solo BLANCOS o ESPUMOSOS.
    - La explicación debe ser MAGISTRAL, APASIONADA y LARGA (mínimo 350 palabras). No escatimes en detalles.
    - Elige exactamente 3 vinos: 2 de ALTA_GAMA y 1 de OPCIÓN_ECONÓMICA.
    
    RESPUESTA: Devuelve SOLO un objeto JSON con las claves "explicacion" y "vins_triats".`;

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
          { role: 'user', content: `Pregunta: ${pregunta}. Contexto ALTA_GAMA: ${JSON.stringify(seleccioPremium)}. Contexto ECONOMICA: ${JSON.stringify(seleccioEcon)}.` }
        ],
        temperature: 0.3
      })
    });

    const data = await groqResponse.json();
    if (!data.choices || !data.choices[0]) throw new Error("IA no responde");

    const contingut = JSON.parse(data.choices[0].message.content);
    
    // Gestió final de vins (Vi preguntat + 3 recomanats)
    let vinsResultat = contingut.vins_triats || [];
    if (viPrincipal && !vinsResultat.some(v => v.nom === viPrincipal.nom)) {
      vinsResultat.unshift(viPrincipal);
    }

    const explicacioOk = contingut.explicacio || contingut.explicación || "Error en generar el text.";

    // Retornem el format que el teu frontend espera
    res.status(200).json({ resposta: `${explicacioOk} ||| ${JSON.stringify(vinsResultat)}` });

  } catch (error) {
    console.error(error);
    res.status(200).json({ resposta: `El sommelier ha tingut un problema: ${error.message} ||| []` });
  }
};
