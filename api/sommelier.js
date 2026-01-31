const admin = require('firebase-admin');

module.exports = async (req, res) => {
  // 1. Seguretat: Només acceptem peticions POST
  if (req.method !== 'POST') return res.status(405).json({ error: 'Mètode no permès' });

  try {
    const { pregunta } = req.body;
    let rawKey = process.env.FIREBASE_SERVICE_ACCOUNT || "";

    // Neteja de caràcters invisibles que sovint causen l'error "Unexpected token E"
    rawKey = rawKey.trim();

    // Verificació de seguretat: si no comença amb {, avisem per no petar
    if (!rawKey.startsWith("{")) {
      return res.status(200).json({ 
        resposta: "Error de configuració: Vercel encara llegeix el text d'error antic. Si us plau, fes un 'Redeploy' a Vercel." 
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
    
    let cellerInfo = "Llista de vins del celler d'en Pere:\n";
    snapshot.forEach(doc => {
      const d = doc.data();
      cellerInfo += `- Nom: ${d.nom}, DO: ${d.do}, Preu: ${d.preu}€\n`;
    });

    // 3. Connexió amb Groq (Intel·ligència Artificial)
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
            content: `Ets el sommelier d'en Pere. Respon sempre en català. Sigues breu, expert i amable. Fes servir aquestes dades reals: ${cellerInfo}` 
          },
          { role: 'user', content: pregunta }
        ]
      })
    });

    const data = await response.json();
    const textIA = data.choices?.[0]?.message?.content || "Ho sento, Groq no ha pogut generar una resposta.";
    
    res.status(200).json({ resposta: textIA });

  } catch (error) {
    // Si falla el JSON.parse o la connexió, ho veuràs aquí
    res.status(500).json({ resposta: "Error tècnic detectat: " + error.message });
  }
};
