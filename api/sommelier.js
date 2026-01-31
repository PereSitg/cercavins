const admin = require('firebase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Mètode no permès' });

  try {
    const { pregunta } = req.body;
    const rawKey = process.env.FIREBASE_SERVICE_ACCOUNT || "";

    // 1. Verificació de seguretat per no fallar en el JSON.parse
    if (!rawKey.startsWith("{")) {
      return res.status(200).json({ 
        resposta: "Error de variable: Vercel encara llegeix text d'error, no el JSON de la clau." 
      });
    }

    // 2. Inicialització de Firebase
    if (!admin.apps.length) {
      const serviceAccount = JSON.parse(rawKey.replace(/\\n/g, '\n'));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }
    
    const db = admin.firestore();
    const snapshot = await db.collection('cercavins').get();
    
    let cellerInfo = 'Llista de vins del celler d\'en Pere:\n';
    snapshot.forEach(doc => {
      const d = doc.data();
      cellerInfo += `- Nom: ${d.nom}, DO: ${d.do}, Preu: ${d.preu}€\n`;
    });

    // 3. Connexió amb Groq
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { 
            role: 'system', 
            content: `Ets el sommelier d'en Pere. Respon sempre en català. Sigues breu i amable. Fes servir aquestes dades: ${cellerInfo}` 
          },
          { role: 'user', content: pregunta }
        ]
      })
    });

    const data = await response.json();
    const textIA = data.choices?.[0]?.message?.content || "Ho sento, Groq no ha pogut respondre.";
    
    res.status(200).json({ resposta: textIA });

  } catch (error) {
    res.status(500).json({ resposta: "Error tècnic: " + error.message });
  }
};
