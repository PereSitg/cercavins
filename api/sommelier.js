const admin = require('firebase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta } = req.body;

    // 1. Inicialitzem Firebase
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
    
    // 2. Agafem NOMÉS 10 VINS per a la prova (així no donarà error de longitud)
    const snapshot = await db.collection('cercavins').limit(10).get();
    let celler = '';
    snapshot.forEach(doc => { 
      const d = doc.data();
      celler += `${d.nom}: ${d.preu}€; `; 
    });

    // 3. Crida a Groq amb el model estàndard
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY?.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192', 
        messages: [
          { role: 'system', content: 'Ets el sommelier de Cercavins. Respon breu en català. Vins: ' + celler },
          { role: 'user', content: pregunta }
        ]
      })
    });

    const data = await response.json();

    if (data.error) {
       return res.status(500).json({ resposta: "Error de Groq: " + data.error.message });
    }

    res.status(200).json({ resposta: data.choices[0].message.content });

  } catch (error) {
    res.status(500).json({ resposta: "ERROR: " + error.message });
  }
};
