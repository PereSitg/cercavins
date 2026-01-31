const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT.replace(/\\n/g, '\n'));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Mètode no permès" });

  try {
    const { pregunta } = req.body;
    
    // Fem servir el nom exactat de la teva col·lecció: 'cercavins'
    const snapshot = await db.collection('cercavins').get();
    let celler = "Llista de vins disponibles:\n";
    
    snapshot.forEach(doc => {
      const d = doc.data();
      // Adaptem els camps segons la teva captura: 'nom', 'do' i 'preu'
      celler += `- ${d.nom || 'Vi'} de la DO ${d.do || 'desconeguda'}. Preu: ${d.preu || 'Consultar'}\n`;
    });

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: `Ets el sommelier d'en Pere Badia. Coneixes aquests vins:\n${celler}\nRespon sempre en català i sigues amable.` },
          { role: "user", content: pregunta }
        ]
      })
    });

    const data = await response.json();
    res.status(200).json({ resposta: data.choices[0].message.content });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
