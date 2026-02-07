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
    
    // 1. CERCA DEL VI PRINCIPAL (RESET DE LOGICA)
    let viPrincipal = null;
    if (pregunta) {
      const netejar = (t) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const paraules = netejar(pregunta).split(/\s+/).filter(p => p.length > 3);
      
      if (paraules.length > 0) {
        const totsVins = await db.collection('cercavins').limit(1200).get();
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

    // 2. FILTRAT DE DADES PUR (NOMÉS PASSEM EL QUE ÉS NECESSARI)
    const [premSnap, econSnap] = await Promise.all([
      db.collection('cercavins').where('preu', '>', 35).limit(20).get(),
      db.collection('cercavins').where('preu', '>=', 7).where('preu', '<=', 18).limit(20).get()
    ]);

    const prepararVins = (snap) => {
      return snap.docs.map(doc => {
        const d = doc.data();
        return { nom: d.nom, imatge: d.imatge, denominacio_origen: d.do || "DO" };
      }).sort(() => Math.random() - 0.5).slice(0, 10);
    };

    const vinsContext = prepararVins(premSnap).concat(prepararVins(econSnap));

    // 3. SYSTEM PROMPT DE "RESET" (ORDRES ÚNIQUES I ESTRICTES)
    const promptSystem = `ACTUA COM UN SOMMELIER D'ELIT.
    IDIOMA: RESPON EXCLUSIVAMENT EN CATALÀ.
    
    INSTRUCCIONS DE SEGURETAT (RESET):
    - NO USIS MAI "Vila Viniteca" com a Denominació d'Origen (DO).
    - USA SEMPRE la "denominacio_origen" que t'entrego al JSON de vins.
    - Si l'usuari pregunta per MARISC o PERCEBES, tria només BLANCS o ESCUMOSOS.
    - L'explicació ha de ser MAGISTRAL, d'un expert culte, amb un mínim de 400 paraules.
    
    FORMAT VISUAL OBLIGATORI:
    - Nom del vi: <span class="nom-vi-destacat">...</span>
    - DO, Raïm o Celler: <span class="text-destacat-groc">...</span>
    
    RESPOSTA: Només JSON pur: {"explicacio": "...", "vins_triats": [{"nom": "...", "imatge": "..."}]}`;

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
          { role: 'user', content: `Pregunta: ${pregunta}. Llista de vins reals: ${JSON.stringify(vinsContext)}` }
        ],
        temperature: 0.1 // TEMPERATURA MÍNIMA PER EVITAR AL·LUCINACIONS
      })
    });

    const data = await groqResponse.json();
    const contingut = JSON.parse(data.choices[0].message.content);
    
    // 4. MUNTATGE FINAL
    let vinsFinals = contingut.vins_triats || [];
    if (viPrincipal) {
      vinsFinals = [viPrincipal, ...vinsFinals.filter(v => v.nom !== viPrincipal.nom)].slice(0, 4);
    }

    const textFinal = contingut.explicacio || Object.values(contingut).find(v => typeof v === 'string');

    res.status(200).json({ resposta: `${textFinal} ||| ${JSON.stringify(vinsFinals)}` });

  } catch (error) {
    res.status(200).json({ resposta: `Error en el sistema: ${error.message} ||| []` });
  }
};
