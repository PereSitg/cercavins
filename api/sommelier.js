const admin = require('firebase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta } = req.body;

    // 1. Configurem les claus netejant espais en blanc (trim)
    const groqKey = process.env.GROQ_API_KEY ? process.env.GROQ_API_KEY.trim() : "";
    const fbProjectID = process.env.FIREBASE_PROJECT_ID ? process.env.FIREBASE_PROJECT_ID.trim() : "";
    const fbEmail = process.env.FIREBASE_CLIENT_EMAIL ? process.env.FIREBASE_CLIENT_EMAIL.trim() : "";
    const fbKey = process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n').trim() : "";

    // 2. Inicialitzem Firebase només si no està ja inicialitzat
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: fbProjectID,
          clientEmail: fbEmail,
          privateKey: fbKey,
        }),
      });
    }
    
    const db = admin.firestore();
    
    // 3. Llegim els vins
    const snapshot = await db.collection('cercavins').get();
    let celler = '';
    snapshot.forEach(doc => { 
      const d = doc.data();
      celler += `${d.nom}(${d.do},${d.preu}€); `; 
    });

    // 4. Crida a Groq amb la clau neta
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant', 
        messages: [
          { role: 'system', content: 'Ets el sommelier de Cercavins. Respon breu en català. Vins: ' + celler },
          { role: 'user', content: pregunta }
        ],
        max_tokens: 400
      })
    });

    const data = await response.json();

    if (data.error) {
       // Si Groq torna a fallar, ens dirà exactament per què
       return res.status(500).json({ resposta: "Error de Groq: " + data.error.message });
    }

    res.status(200).json({ resposta: data.choices[0].message.content });

  } catch (error) {
    // Si hi ha un error de Firebase o de codi, sortirà aquí
    res.status(500).json({ resposta: "ERROR DETECTAT: " + error.message });
  }
};
