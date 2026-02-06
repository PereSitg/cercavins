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
    const snapshot = await db.collection('cercavins').limit(50).get();
    const celler = [];
    snapshot.forEach(doc => {
      const d = doc.data();
      if (d.nom && d.imatge) {
        celler.push({ nom: d.nom, imatge: d.imatge, tipus: d.tipus || "" });
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
        response_format: { type: "json_object" }, // FORCEM MODE JSON
        messages: [
          {
            role: 'system',
            content: `Ets un sommelier. Respon SEMPRE en format JSON.
            Idioma: ${idiomaRes}.
            Normes de text: Frases amb majúscula inicial i després de punt. No posis majúscula a cada paraula.
            Noms de vins: Dins del text, posa els noms així: <span class="nom-vi-destacat">Nom del Vi</span>.
            
            Estructura del JSON a retornar:
            {
              "explicacio": "Text del sommelier aquí...",
              "vins_triats": [{"nom": "Nom 1", "imatge": "URL 1"}, {"nom": "Nom 2", "imatge": "URL 2"}]
            }`
          },
          {
            role: 'user',
            content: `Celler: ${JSON.stringify(celler)}. Pregunta: ${pregunta}`
          }
        ],
        temperature: 0.1
      })
    });

    const data = await groqResponse.json();
    const contingut = JSON.parse(data.choices[0].message.content);

    // Reconstruïm el format que espera el teu frontend: "text ||| json"
    const respostaFinal = `${contingut.explicacio} ||| ${JSON.stringify(contingut.vins_triats)}`;

    res.status(200).json({ resposta: respostaFinal });

  } catch (error) {
    res.status(200).json({ resposta: `Error: ${error.message} ||| []` });
  }
};
