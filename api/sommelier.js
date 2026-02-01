const admin = require('firebase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta } = req.body;

    // 1. Intentem inicialitzar Firebase
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
    
    // 2. Intentem llegir la base de dades
    const snapshot = await db.collection('cercavins').get();
    let celler = '';
    snapshot.forEach(doc => { 
      const d = doc.data();
      celler += `${d.nom}(${d.do},${d.preu}€); `; 
    });

    // 3. Intentem parlar amb Groq
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
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
       return res.status(500).json({ resposta: "Error de Groq: " + data.error.message });
    }

    res.status(200).json({ resposta: data.choices[0].message.content });

  } catch (error) {
    // AQUESTA LÍNIA ÉS LA CLAU: Ens dirà l'error real a la pantalla de la web
    res.status(500).json({ resposta: "ERROR DETECTAT: " + error.message });
  }
};
