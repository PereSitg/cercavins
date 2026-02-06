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
    
    // Agafem 50 vins per tenir varietat real
    const snapshot = await db.collection('cercavins').limit(50).get();
    const celler = [];
    snapshot.forEach(doc => {
      const d = doc.data();
      if (d.nom && d.imatge) {
        celler.push({ n: d.nom, i: d.imatge, t: d.tipus || "" });
      }
    });

    const langMap = { 'ca': 'CATALÀ', 'es': 'CASTELLANO', 'en': 'ENGLISH', 'fr': 'FRANÇAIS' };
    const idiomaRes = langMap[idioma?.slice(0, 2)] || 'CATALÀ';

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
            content: `Ets un sommelier professional. Respon en ${idiomaRes}.
            NORMES GRAMATICALS ESTRICTES:
            1. Escriu frases normals: majúscula NOMÉS a l'inici de frase i després de punt. 
            2. La resta del text ha d'anar en minúscules (excepte noms propis).
            3. NO posis majúscula a cada paraula.
            4. Noms de vins: <span class="nom-vi-destacat">Nom del Vi</span>.
            5. Tria 3 vins del catàleg.
            6. FORMAT: Text explicatiu ||| [{"nom":"...","imatge":"..."}]`
          },
          {
            role: 'user',
            content: `Celler: ${JSON.stringify(celler)}. Pregunta: ${pregunta}`
          }
        ],
        temperature: 0.2 // Baixem la temperatura al mínim perquè no inventi formats
      })
    });

    const data = await groqResponse.json();
    if (data.error) throw new Error(data.error.message);

    const respostaIA = data.choices[0].message.content;

    res.status(200).json({
      resposta: respostaIA.includes('|||') ? respostaIA : `${respostaIA} ||| []`
    });

  } catch (error) {
    res.status(200).json({ 
      resposta: `Error en el servei: ${error.message} ||| []` 
    });
  }
};
