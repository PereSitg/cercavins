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

    // 1. CERCA DEL VI PRINCIPAL (CUNE, ETC.)
    let viPrincipal = null;
    const paraules = pregunta?.split(/\s+/) || [];
    const paraulaClau = paraules.find(p => p.length > 3);
    
    if (paraulaClau) {
      const nomCerca = paraulaClau.charAt(0).toUpperCase() + paraulaClau.slice(1).toLowerCase();
      const cercaSnap = await db.collection('cercavins')
        .where('nom', '>=', nomCerca)
        .where('nom', '<=', nomCerca + '\uf8ff')
        .limit(1).get();
      
      if (!cercaSnap.empty) {
        const d = cercaSnap.docs[0].data();
        viPrincipal = { nom: d.nom, imatge: d.imatge, do: d.do };
      }
    }

    // 2. RECUPERACIÓ DE VINS COMPLEMENTARIS
    const [premSnap, econSnap] = await Promise.all([
      db.collection('cercavins').where('preu', '>', 35).limit(40).get(),
      db.collection('cercavins').where('preu', '>=', 7).where('preu', '<=', 18).limit(40).get()
    ]);

    const shuffle = (array) => array.sort(() => Math.random() - 0.5);
    const netejar = (snap) => {
      let l = [];
      snap.forEach(doc => {
        const d = doc.data();
        l.push({ nom: d.nom, do: d.do || "DO", imatge: d.imatge, preu: d.preu });
      });
      return shuffle(l).slice(0, 15);
    };

    // 3. PROMPT ADAPTATIU
    const promptSystem = `Ets un Sommelier d'elit. Respon en ${idiomaReal}.
    
    INSTRUCCIONS DE CONTINGUT:
    - Si l'usuari pregunta per un VI CONCRET: Explica la seva història, celler, zona i notes de tast de forma extensa (350 paraules). Suggerix 3 vins més de les llistes que siguin coherents.
    - Si l'usuari pregunta per un MARIDATGE: Tria els vins segons el menjar (Blancs/Escumosos per peix, Negres per carn).
    
    FORMAT VISUAL:
    - Noms de vins: <span class="nom-vi-destacat">...</span>
    - DO, Raïms i Cellers: <span class="text-destacat-groc">...</span>
    
    FORMAT JSON: {"explicacio": "...", "vins_triats": [{"nom": "...", "imatge": "..."}]}`;

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
          { role: 'user', content: `Pregunta: ${pregunta}. Vi detectat: ${viPrincipal ? viPrincipal.nom : 'Cap'}. ALTA_GAMA: ${JSON.stringify(netejar(premSnap))}. OPCIÓ_ASSEQUIBLE: ${JSON.stringify(netejar(econSnap))}.` }
        ],
        temperature: 0.3
      })
    });

    const data = await groqResponse.json();
    const contingut = JSON.parse(data.choices[0].message.content);
    
    const explicacioFinal = contingut.explicacio || contingut.explicación || Object.values(contingut).find(v => typeof v === 'string' && v.length > 100);
    
    let vinsFinals = contingut.vins_triats || [];
    if (viPrincipal && !vinsFinals.some(v => v.nom === viPrincipal.nom)) {
      vinsFinals.unshift(viPrincipal);
    }

    res.status(200).json({ resposta: `${explicacioFinal} ||| ${JSON.stringify(vinsFinals)}` });

  } catch (error) {
    res.status(200).json({ resposta: `Error: ${error.message} ||| []` });
  }
};
