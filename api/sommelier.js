const admin = require('firebase-admin');

// 1. INICIALITZACIÓ (Fora de l'handler per reutilitzar la connexió)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

// DEFINIM DB AQUÍ PERQUÈ ESTIGUI DISPONIBLE A TOT EL FITXER
const db = admin.firestore();

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta, idioma } = req.body;
    const p = pregunta.toLowerCase();

    // 2. CERCA DE VINS ASSEQUIBLES (Ara que ja són Numbers!)
    // Busquem vins entre 7 i 20 euros
    const assequiblesSnapshot = await db.collection('cercavins')
      .where('preu', '>=', 7)
      .where('preu', '<=', 20)
      .limit(10)
      .get();

    let vinsAssequibles = [];
    assequiblesSnapshot.forEach(doc => {
      const d = doc.data();
      vinsAssequibles.push({ 
        nom: d.nom, 
        imatge: d.imatge, 
        do: d.do || "DO", 
        preu: d.preu, 
        perfil: "economica" 
      });
    });

    // 3. CERCA GENERAL (Per donar varietat)
    const snapshot = await db.collection('cercavins').limit(20).get();
    let cellerGeneral = [];
    snapshot.forEach(doc => {
      const d = doc.data();
      cellerGeneral.push({ 
        nom: d.nom, 
        imatge: d.imatge, 
        do: d.do || "DO", 
        preu: d.preu 
      });
    });

    const contextTotal = [...vinsAssequibles, ...cellerGeneral];

    const langMap = { 'ca': 'CATALÀ', 'es': 'CASTELLANO', 'en': 'ENGLISH' };
    const idiomaRes = langMap[idioma?.slice(0, 2)] || 'CATALÀ';

    // 4. CRIDA A GROQ
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
          {
            role: 'system',
            content: `Ets un sommelier expert. Idioma: ${idiomaRes}.
            - Tria 3 vins del context proporcionat.
            - El tercer vi ha de ser un dels de perfil 'economica'.
            - NO posis majúscula a cada paraula.
            - NO mencionis preus numèrics.
            - Usa <span class="nom-vi-destacat"> pel nom dels vins.`
          },
          {
            role: 'user',
            content: `Vins: ${JSON.stringify(contextTotal)}. Pregunta: ${pregunta}`
          }
        ],
        temperature: 0.5
      })
    });

    const data = await groqResponse.json();
    const contingut = JSON.parse(data.choices[0].message.content);

    // Format final per al teu frontend
    const respostaFinal = `${contingut.explicacio} ||| ${JSON.stringify(contingut.vins_triats)}`;
    res.status(200).json({ resposta: respostaFinal });

  } catch (error) {
    res.status(200).json({ resposta: `Error: ${error.message} ||| []` });
  }
};
