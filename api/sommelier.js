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

    // 1. Preparem els dos grups de vins ben diferenciats
    const assequiblesSnapshot = await db.collection('cercavins')
      .where('preu', '>=', 7)
      .where('preu', '<=', 20)
      .limit(10)
      .get();

    let grupEconòmic = [];
    assequiblesSnapshot.forEach(doc => {
      const d = doc.data();
      grupEconòmic.push({ nom: d.nom, do: d.do || "DO", preu: d.preu, imatge: d.imatge, categoria: "ECONÒMICA" });
    });

    const generalSnapshot = await db.collection('cercavins')
      .where('preu', '>', 20) // Busquem vins de més de 20€ per contrastar
      .limit(15)
      .get();

    let grupPremium = [];
    generalSnapshot.forEach(doc => {
      const d = doc.data();
      grupPremium.push({ nom: d.nom, do: d.do || "DO", preu: d.preu, imatge: d.imatge, categoria: "PREMIUM" });
    });

    const langMap = { 'ca': 'CATALÀ', 'es': 'CASTELLANO', 'en': 'ENGLISH' };
    const idiomaRes = langMap[idioma?.slice(0, 2)] || 'CATALÀ';

    // 2. Crida a Groq amb regles de selecció estrictes
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
            content: `Ets un sommelier de prestigi. Idioma: ${idiomaRes}.
            
            REGLA D'OR PER LA TRIA DE VINS:
            - Has de triar exactament 3 vins.
            - Els 2 primers vins han de ser de la categoria 'PREMIUM'. Són vins especials i complexos.
            - El 3er vi ha de ser de la categoria 'ECONÒMICA'. Presenta'l com una troballa amb una relació qualitat-preu immillorable.
            
            ESTIL DE RESPOSTA:
            - Escriu una explicació detallada i passional per a cada vi (un paràgraf per vi).
            - No diguis el preu ni la paraula "barat". Usa termes com "assequible", "excel·lent relació qualitat-preu" o "opció amable".
            - Usa <span class="nom-vi-destacat"> pel nom dels vins.
            
            FORMAT JSON: {"explicacio": "...", "vins_triats": [{"nom": "...", "imatge": "..."}]}`
          },
          {
            role: 'user',
            content: `Vins PREMIUM: ${JSON.stringify(grupPremium)}. Vins ECONÒMICS: ${JSON.stringify(grupEconòmic)}. Pregunta: ${pregunta}`
          }
        ],
        temperature: 0.6
      })
    });

    const data = await groqResponse.json();
    if (!data.choices || !data.choices[0]) throw new Error("Error en la resposta de la IA");

    const contingut = JSON.parse(data.choices[0].message.content);
    res.status(200).json({ resposta: `${contingut.explicacio} ||| ${JSON.stringify(contingut.vins_triats)}` });

  } catch (error) {
    res.status(200).json({ resposta: `Error: ${error.message} ||| []` });
  }
};
