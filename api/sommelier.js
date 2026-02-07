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

    // 1. Agafem vins assequibles
    const assequiblesSnapshot = await db.collection('cercavins')
      .where('preu', '>=', 7)
      .where('preu', '<=', 20)
      .limit(8)
      .get();

    let vinsContext = [];
    assequiblesSnapshot.forEach(doc => {
      const d = doc.data();
      vinsContext.push({ nom: d.nom, do: d.do || "DO", preu: d.preu, imatge: d.imatge, perfil: "economica" });
    });

    // 2. Agafem uns quants més generals
    const snapshot = await db.collection('cercavins').limit(12).get();
    snapshot.forEach(doc => {
      const d = doc.data();
      vinsContext.push({ nom: d.nom, do: d.do || "DO", preu: d.preu, imatge: d.imatge });
    });

    const langMap = { 'ca': 'CATALÀ', 'es': 'CASTELLANO', 'en': 'ENGLISH' };
    const idiomaRes = langMap[idioma?.slice(0, 2)] || 'CATALÀ';

    // 3. Crida a Groq amb protecció
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
            content: `Ets un sommelier expert. Idioma: ${idiomaRes}. Respon en JSON amb: {"explicacio": "...", "vins_triats": [{"nom": "...", "imatge": "..."}]}. Tria 3 vins, un d'ells 'economica'. No posis preus.`
          },
          {
            role: 'user',
            content: `Vins: ${JSON.stringify(vinsContext)}. Pregunta: ${pregunta}`
          }
        ]
      })
    });

    const data = await groqResponse.json();

    // --- PROTECCIÓ CONTRA L'ERROR 'UNDEFINED 0' ---
    if (!data.choices || !data.choices[0]) {
      console.error("Error de Groq:", data);
      throw new Error(data.error?.message || "La IA no ha tornat resultats (possible límit de quota)");
    }

    const contingut = JSON.parse(data.choices[0].message.content);
    const respostaFinal = `${contingut.explicacio} ||| ${JSON.stringify(contingut.vins_triats)}`;
    
    res.status(200).json({ resposta: respostaFinal });

  } catch (error) {
    console.error("Error en el handler:", error);
    res.status(200).json({ 
      resposta: `Ho sento Pere, tinc un petit embús al celler: ${error.message} ||| []` 
    });
  }
};
