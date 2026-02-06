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
    
    // 1. LIMITACIÓ ESTRICTA A 15 DOCUMENTS (Per evitar saturar Groq)
    const snapshot = await db.collection('cercavins').limit(15).get();
    const celler = [];
    snapshot.forEach(doc => {
      const d = doc.data();
      if (d.nom && d.imatge) {
        celler.push({ n: d.nom.toLowerCase(), i: d.imatge });
      }
    });

    const langMap = { 'ca': 'CATALÀ', 'es': 'CASTELLANO', 'en': 'ENGLISH', 'fr': 'FRANÇAIS' };
    const idiomaRes = langMap[idioma?.slice(0, 2)] || 'CATALÀ';

    // 2. PROMPT MINIMALISTA (Menys text = resposta més ràpida i sense errors)
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY?.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        messages: [
          {
            role: 'system',
            content: `sommelier professional en ${idiomaRes}. respon tot en minúscules. usa <span class="nom-vi-destacat">per als noms</span>. format: text ||| [{"nom":"...","imatge":"..."}]`
          },
          {
            role: 'user',
            content: `vins: ${JSON.stringify(celler)}. pregunta: ${pregunta}`
          }
        ],
        temperature: 0.1 // Més precisió, menys "creativitat" que pugui trencar el format
      })
    });

    const data = await groqResponse.json();
    
    // Verificació de seguretat
    if (!data.choices || !data.choices[0]) {
      return res.status(200).json({ resposta: "la ia està saturada. prova de nou en un segon. ||| []" });
    }

    const respostaIA = data.choices[0].message.content;
    res.status(200).json({
      resposta: respostaIA.includes('|||') ? respostaIA : `${respostaIA} ||| []`
    });

  } catch (error) {
    res.status(200).json({ resposta: `error: ${error.message} ||| []` });
  }
};
