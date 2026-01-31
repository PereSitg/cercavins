const admin = require('firebase-admin');

let db;

if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT.replace(/\\n/g, '\n')
    );
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    db = admin.firestore();
  } catch (error) {
    console.error('Error Firebase:', error.message);
  }
} else {
  db = admin.firestore();
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Mètode no permès' });

  try {
    const { pregunta } = req.body;
    const snapshot = await db.collection('cercavins').get();
    let celler = 'Vins: ';
    snapshot.forEach(doc => {
      const d = doc.data();
      celler += `${d.nom} (${d.preu}), `;
    });

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'Ets el sommelier. Vins: ' + celler },
          { role: 'user', content: pregunta }
        ]
      })
    });

    const data = await response.json();
    // AQUESTA LÍNIA ÉS LA QUE TREU L'UNDEFINED:
    const textIA = data.choices?.[0]?.message?.content || "No tinc resposta.";
    
    res.status(200).json({ resposta: textIA });
  } catch (error) {
    res.status(500).json({ resposta: "Error: " + error.message });
  }
};
