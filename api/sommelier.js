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
    
    // 1. DETECCIÓ D'IDIOMA DEL SISTEMA
    const langMap = { 'ca': 'CATALÀ', 'es': 'CASTELLANO', 'en': 'ENGLISH', 'fr': 'FRANÇAIS' };
    const codiClient = (idioma || 'ca').toLowerCase().slice(0, 2);
    const idiomaReal = langMap[codiClient] || 'CASTELLANO';

    // 2. CERCA DEL VI DE LA PREGUNTA (PER LA FOTO)
    let viPrincipal = null;
    if (pregunta) {
      const netejar = (t) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const paraules = netejar(pregunta).split(/\s+/).filter(p => p.length > 3);
      
      if (paraules.length > 0) {
        const totsVins = await db.collection('cercavins').limit(1000).get();
        const trobat = totsVins.docs.find(doc => {
          const nomDB = netejar(doc.data().nom || "");
          return paraules.some(p => nomDB.includes(p));
        });
        if (trobat) {
          const d = trobat.data();
          viPrincipal = { nom: d.nom, imatge: d.imatge };
        }
      }
    }

    // 3. RECUPERACIÓ DE VINS DE LA BBDD (2 llistes)
    const [premSnap, econSnap] = await Promise.all([
      db.collection('cercavins').where('preu', '>', 35).limit(25).get(),
      db.collection('cercavins').where('preu', '>=', 7).where('preu', '<=', 18).limit(25).get()
    ]);

    const prepararVins = (snap) => {
      return snap.docs.map(doc => {
        const d = doc.data();
        return { nom: d.nom, imatge: d.imatge, do_real: d.do || "DO" };
      }).sort(() => Math.random() - 0.5);
    };

    const llistaAltaGama = prepararVins(premSnap);
    const llistaEcon = prepararVins(econSnap);

    // 4. PROMPT ULTRA-ESTRICTE (OBLIGACIÓ DE 3 VINS)
    const promptSystem = `Ets un Sommelier d'elit. 
    IDIOMA: Respon exclusivament en ${idiomaReal}.
    
    ORDRES CRÍTIQUES:
    1. L'explicació ha de tenir un mínim de 450 paraules. Sigues magistral.
    2. Has de triar EXACTAMENT 3 VINS de la llista que et dono: 2 de ALTA GAMA i 1 de ECONOMICA.
    3. No t'inventis les DO. Usa el camp "do_real".
    4. Usa <span class="nom-vi-destacat"> pel nom i <span class="text-destacat-groc"> per la DO.
    
    JSON OBLIGATORI: {"explicacio": "...", "vins_triats": [{"nom": "...", "imatge": "..."}, {"nom": "...", "imatge": "..."}, {"nom": "...", "imatge": "..."}]}`;

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
          { role: 'user', content: `Consulta: ${pregunta}. ALTA GAMA: ${JSON.stringify(llistaAltaGama.slice(0,10))}. ECONOMICA: ${JSON.stringify(llistaEcon.slice(0,10))}` }
        ],
        temperature: 0.1
      })
    });

    const data = await groqResponse.json();
    const contingut = JSON.parse(data.choices[0].message.content);
    
    // 5. ASSEGURAR QUE SURTEN ELS 4 VINS (EL DE LA PREGUNTA + ELS 3 RECOMANATS)
    let vinsFinals = contingut.vins_triats || [];
    
    if (viPrincipal) {
      // Afegim el vi de la pregunta al principi i mantenim els 3 de la IA
      vinsFinals = [viPrincipal, ...vinsFinals.filter(v => v.nom !== viPrincipal.nom)].slice(0, 4);
    }

    const textFinal = contingut.explicacio || Object.values(contingut).find(v => typeof v === 'string');

    res.status(200).json({ resposta: `${textFinal} ||| ${JSON.stringify(vinsFinals)}` });

  } catch (error) {
    res.status(200).json({ resposta: `Error: ${error.message} ||| []` });
  }
};
