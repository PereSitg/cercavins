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
    // SEGURETAT 1: Validem que la pregunta existeixi
    const { pregunta, idioma } = req.body;
    if (!pregunta) throw new Error("Pregunta no rebuda");
    
    const p = pregunta.toLowerCase();
    const langMap = { 'ca': 'CATALÀ', 'es': 'CASTELLANO', 'en': 'ENGLISH', 'fr': 'FRANÇAIS' };
    const idiomaReal = langMap[(idioma || 'ca').toLowerCase().slice(0, 2)] || 'CATALÀ';

    // 1. Recuperació de vins
    const [premSnap, econSnap] = await Promise.all([
      db.collection('cercavins').where('preu', '>', 35).limit(60).get(),
      db.collection('cercavins').where('preu', '>=', 7).where('preu', '<=', 18).limit(60).get()
    ]);

    const filtrarVins = (snap) => {
      return snap.docs
        .map(doc => {
          const d = doc.data();
          return { 
            nom: d.nom || "Vi desconegut", 
            imatge: d.imatge || "", 
            do: d.do || "DO",
            cerca: `${d.nom} ${d.do} ${d.varietat || ''} ${d.tipus || ''}`.toLowerCase()
          };
        })
        .filter(v => v.imatge && v.imatge.startsWith('http') && !v.imatge.includes('viniteca'))
        .sort(() => Math.random() - 0.5)
        .slice(0, 15);
    };

    const llistaAlta = filtrarVins(premSnap);
    const llistaEcon = filtrarVins(econSnap);
    const llistaTotal = [...llistaAlta, ...llistaEcon];

    // SEGURETAT 2: Si no hi ha vins a la llista, no cridem a la IA per evitar errors
    if (llistaTotal.length === 0) throw new Error("No s'han trobat vins amb imatge");

    // 2. Prompt estricte
    const promptSystem = `Ets un Sommelier d'elit. Respon en ${idiomaReal}. 
    Escriu 300 paraules. Usa <span class="nom-vi-destacat">NOM</span> i <span class="text-destacat-groc">DO</span>.
    Tria EXACTAMENT 3 vins del JSON i retorna AQUEST FORMAT:
    {"explicacio": "...", "vins_triats": [{"nom": "...", "imatge": "..."}]}`;

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY?.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant', 
        response_format: { type: "json_object" },
        messages: [
          { role: 'system', content: promptSystem },
          { role: 'user', content: `Consulta: ${pregunta}. Vins: ${JSON.stringify(llistaTotal)}` }
        ],
        temperature: 0.2
      })
    });

    const data = await groqResponse.json();
    
    // SEGURETAT 3: Validem la resposta de Groq abans de fer el JSON.parse
    if (!data.choices || !data.choices[0]?.message?.content) {
       throw new Error("La IA no ha respost correctament");
    }

    const contingut = JSON.parse(data.choices[0].message.content);
    
    // Reconstruïm els vins per assegurar que les imatges NO siguin undefined
    const vinsFinals = (contingut.vins_triats || []).slice(0, 3).map(vIA => {
       const original = llistaTotal.find(f => f.nom === vIA.nom) || llistaTotal[0];
       return { nom: original.nom, imatge: original.imatge };
    });

    res.status(200).json({ 
      resposta: `${contingut.explicacio || "Aquí tens la meva selecció."} ||| ${JSON.stringify(vinsFinals)}` 
    });

  } catch (error) {
    console.error("Error detallat:", error.message);
    // En cas d'error, enviem una resposta que el frontend pugui llegir sense petar
    res.status(200).json({ 
      resposta: `El sommelier està acabant de decantar el vi. Torna a preguntar d'aquí a un segon! ||| []` 
    });
  }
};
