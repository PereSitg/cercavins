const admin = require('firebase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    // 1. Rebem la pregunta i l'idioma detectat per l'ordinador
    const { pregunta, idioma } = req.body;

    // Configurem l'idioma de resposta
    let llenguaResposta = "CATALÀ";
    if (idioma) {
        if (idioma.startsWith('fr')) llenguaResposta = "FRANCÈS (FRANÇAIS)";
        else if (idioma.startsWith('es')) llenguaResposta = "CASTELLÀ (CASTELLANO)";
        else if (idioma.startsWith('en')) llenguaResposta = "ANGLÈS (ENGLISH)";
    }

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n').trim(),
        }),
      });
    }
    
    const db = admin.firestore();
    // Pugem a 40 per tenir prou varietat de blancs/escumosos
    const snapshot = await db.collection('cercavins').limit(40).get(); 
    let celler = [];
    
    snapshot.forEach(doc => { 
      const d = doc.data();
      celler.push({
        nom: d.nom,
        do: d.do,
        imatge: d.imatge,
        tipus: d.tipus
      });
    });

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
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
            content: `Ets un Sommelier d'elit. La teva prioritat absoluta és la COHERÈNCIA del maridatge.
            
            NORMES DE MARIDATGE:
            1. Si demanen marisc (percebes, gambes, etc.), selecciona NOMÉS blancs o escumosos. No recomanis MAI vins negres amb percebes.
            2. És millor recomanar només 1 o 2 vins si són els únics que realment lliguen, que intentar omplir la llista amb vins que no toquen.
            3. Explica breument per què el vi triat és ideal per al plat.

            NORMES DE FORMAT:
            1. Respon SEMPRE en idioma ${llenguaResposta}.
            2. NO posis asteriscs (*) ni negretes (**) en els noms dels vins. Escriu-los tal qual estan al llistat.
            3. NO mencionis preus.
            4. Al final de tot, afegeix la cadena "|||" i després el JSON amb els vins recomanats.`
          },
          { role: 'user', content: `Celler disponible: ${JSON.stringify(celler)}. Pregunta del client: ${pregunta}` }
        ]
      })
    });

    const data = await response.json();
    res.status(200).json({ resposta: data.choices[0].message.content });

  } catch (error) {
    res.status(500).json({ resposta: "ERROR: " + error.message });
  }
};
