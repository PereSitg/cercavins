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
    
    // 1. Idioma
    const langMap = { 'ca': 'CATALÀ', 'es': 'CASTELLANO', 'en': 'ENGLISH', 'fr': 'FRANÇAIS' };
    const codiClient = (idioma || 'ca').toLowerCase().slice(0, 2);
    const idiomaReal = langMap[codiClient] || 'CATALÀ';

    // 2. Recuperació de vins (mantenim el filtratge de seguretat)
    const [premSnap, econSnap] = await Promise.all([
      db.collection('cercavins').where('preu', '>', 35).limit(10).get(),
      db.collection('cercavins').where('preu', '>=', 7).where('preu', '<=', 18).limit(10).get()
    ]);

    const filtrarVins = (snap) => {
      return snap.docs
        .map(doc => ({ 
          nom: doc.data().nom, 
          imatge: doc.data().imatge, 
          do_real: doc.data().do || "DO" 
        }))
        .filter(v => v.do_real !== "Vila Viniteca" && v.do_real !== "Desconeguda")
        .sort(() => Math.random() - 0.5)
        .slice(0, 5); 
    };

    const llistaAlta = filtrarVins(premSnap);
    const llistaEcon = filtrarVins(econSnap);

    // 3. PROMPT MILLORAT PER A FORMAT HTML ESTRICTE
    const promptSystem = `Ets un Sommelier d'elit. Respon en ${idiomaReal}. 
    Escriu una recomanació magistral de unes 250 paraules. 
    
    REGLA D'OR DE FORMAT:
    - Cada vegada que mencionis un VI, usa: <span class="nom-vi-destacat">NOM DEL VI</span>.
    - Cada vegada que mencionis una DO, usa: <span class="text-destacat-groc">NOM DO</span>.
    - EXEMPLE: "Et recomano el <span class="nom-vi-destacat">Vega Sicilia</span> de la <span class="text-destacat-groc">Ribera del Duero</span>."

    Tria exactament 3 vins del JSON (2 alta gama, 1 econòmic).
    JSON OBLIGATORI: {"explicacio": "Text amb els span HTML...", "vins_triats": [{"nom": "...", "imatge": "..."}]}`;

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
          { role: 'user', content: `Consulta: ${pregunta}. Vins: ${JSON.stringify({alta: llistaAlta, econ: llistaEcon})}` }
        ],
        temperature: 0.3
      })
    });

    const data = await groqResponse.json();
    if (data.error) throw new Error(data.error.message);

    const contingut = JSON.parse(data.choices[0].message.content);
    
    // 4. Resposta Final
    const vinsFinals = (contingut.vins_triats || []).slice(0, 3);
    const textFinal = contingut.explicacio || "Aquí tens la meva selecció...";

    res.status(200).json({ 
      resposta: `${textFinal} ||| ${JSON.stringify(vinsFinals)}` 
    });

  } catch (error) {
    console.error("ERROR:", error.message);
    res.status(200).json({ 
      resposta: `Ho sento, el sommelier està ocupat. (Error: ${error.message}) ||| []` 
    });
  }
};
