const admin = require('firebase-admin');

// Ja no hi ha claus aquí. El sistema les agafa de "process.env"
const serviceAccount = {
  project_id: process.env.FIREBASE_PROJECT_ID,
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta } = req.body;
    const clauGroq = process.env.GROQ_API_KEY;

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }
    
    const db = admin.firestore();
    const snapshot = await db.collection('cercavins').get();
    
    let celler = '';
    snapshot.forEach(doc => { 
      const d = doc.data();
      celler += `${d.nom}(${d.do},${d.preu}€); `; 
    });

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${clauGroq}`,
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
    res.status(200).json({ resposta: data.choices[0].message.content });

  } catch (error) {
    res.status(500).json({ resposta: "Error de servidor. Revisa les variables d'entorn." });
  }
};
