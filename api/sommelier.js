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
    
    // Mantenim els 50 vins com havies demanat
    const snapshot = await db.collection('cercavins').limit(50).get();
    const celler = [];
    snapshot.forEach(doc => {
      const d = doc.data();
      if (d.nom && d.imatge) {
        celler.push({ n: d.nom.toLowerCase(), i: d.imatge, t: d.tipus || "" });
      }
    });

    const langMap = { 'ca': 'CATALÀ', 'es': 'CASTELLANO', 'en': 'ENGLISH', 'fr': 'FRANÇAIS' };
    const idiomaRes = langMap[idioma?.slice(0, 2)] || 'CATALÀ';

    // 2. CRIDA A LLAMA 3.3 70B (El model actualitzat i potent)
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY?.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile', 
        messages: [
          {
            role: 'system',
            content: `ets un sommelier professional. respon en ${idiomaRes}. tot en minúscules. noms de vins: <span class="nom-vi-destacat">nom del vi</span>. tria 3 vins. format: text ||| [{"nom":"...","imatge":"..."}]`
          },
          {
            role: 'user',
            content: `celler: ${JSON.stringify(celler)}. pregunta: ${pregunta}`
          }
        ],
        temperature: 0.3
      })
    });

    const data = await groqResponse.json();
    
    if (data.error) {
      throw new Error(data.error.message);
    }

    const respostaIA = data.choices[0].message.content;

    res.status(200).json({
      resposta: respostaIA.includes('|||') ? respostaIA : `${respostaIA} ||| []`
    });

  } catch (error) {
    console.error("LOG D'ERROR:", error.message);
    res.status(200).json({ 
      resposta: `error de model: ${error.message} ||| []` 
    });
  }
};
