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
    
    // 1. DETECCIÓ D'IDIOMA
    const langMap = { 'ca': 'CATALÀ', 'es': 'CASTELLANO', 'en': 'ENGLISH', 'fr': 'FRANÇAIS' };
    const codiClient = (idioma || 'ca').toLowerCase().slice(0, 2);
    const idiomaReal = langMap[codiClient] || 'CATALÀ';

    // 2. RECUPERACIÓ DE VINS FILTRANT ERRORS
    // Agafem vins que NO tinguin "Vila Viniteca" a la DO per no fer el ruc
    const [premSnap, econSnap] = await Promise.all([
      db.collection('cercavins')
        .where('preu', '>', 35)
        .limit(40).get(),
      db.collection('cercavins')
        .where('preu', '>=', 7)
        .where('preu', '<=', 18)
        .limit(40).get()
    ]);

    const prepararVins = (snap) => {
      return snap.docs
        .map(doc => {
          const d = doc.data();
          return { nom: d.nom, imatge: d.imatge, do_real: d.do || "DO" };
        })
        // Filtrem per evitar que el sommelier recomani vins amb la DO malament
        .filter(v => v.do_real !== "Vila Viniteca" && v.do_real !== "Desconeguda")
        .sort(() => Math.random() - 0.5)
        .slice(0, 10);
    };

    const llistaAltaGama = prepararVins(premSnap);
    const llistaEcon = prepararVins(econSnap);

    // 3. CERCA DEL VI DE LA PREGUNTA (Millorada)
    let viPrincipal = null;
    if (pregunta) {
      const netejar = (t) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const paraules = netejar(pregunta).split(/\s+/).filter(p => p.length > 3);
      
      if (paraules.length > 0) {
        // Busquem en una mostra aleatòria si no tenim index global
        const trobat = llistaAltaGama.concat(llistaEcon).find(v => {
          const nomNet = netejar(v.nom);
          return paraules.some(p => nomNet.includes(p));
        });
        if (trobat) viPrincipal = { nom: trobat.nom, imatge: trobat.imatge };
      }
    }

    // 4. PROMPT REFORMATAT PER EVITAR ERRORS
    const promptSystem = `Ets un Sommelier d'elit. 
    Respon EXCLUSIVAMENT en ${idiomaReal}.
    
    ORDRES:
    1. Text magistral i extens (unes 400 paraules).
    2. Tria EXACTAMENT 3 vins dels llistats: 2 de ALTA GAMA i 1 de ECONOMICA.
    3. IMPORTANT: Usa <span class="nom-vi-destacat"> pel nom i <span class="text-destacat-groc"> per la DO.
    
    JSON REQUERIT:
    {
      "explicacio": "Text HTML aquí...",
      "vins_triats": [{"nom": "Nom exactat", "imatge": "URL"}]
    }`;

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
          { role: 'user', content: `Consulta: ${pregunta}. Vins disponibles: ALTA GAMA: ${JSON.stringify(llistaAltaGama)}. ECONOMICA: ${JSON.stringify(llistaEcon)}` }
        ],
        temperature: 0.3
      })
    });

    const data = await groqResponse.json();
    if (!data.choices) throw new Error("La IA no ha respost");

    const contingut = JSON.parse(data.choices[0].message.content);
    
    // 5. MUNTATGE DE LA RESPOSTA
    let vinsFinals = contingut.vins_triats || [];
    if (viPrincipal && !vinsFinals.find(v => v.nom === viPrincipal.nom)) {
      vinsFinals = [viPrincipal, ...vinsFinals].slice(0, 4);
    }

    const textFinal = contingut.explicacio || "Ho sento, he tingut un problema generant la resposta.";

    res.status(200).json({ 
      resposta: `${textFinal} ||| ${JSON.stringify(vinsFinals)}` 
    });

  } catch (error) {
    console.error("Error Sommelier:", error);
    res.status(200).json({ 
      resposta: `Error: He tingut un problema amb el tast. Torna-ho a provar en un moment. ||| []` 
    });
  }
};
