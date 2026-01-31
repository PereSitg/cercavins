const admin = require('firebase-admin');

if (!admin.apps.length) {
  // Arreglem els salts de línia de la clau que et vaig donar perquè Vercel no falli
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT.replace(/\\n/g, '\n'));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

// A Vercel s'usa 'module.exports' i rep 'req' (request) i 'res' (response)
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Mètode no permès" });
  }

  try {
    // A Vercel les dades ja venen a 'req.body', no cal fer JSON.parse
    const { pregunta } = req.body;

    const snapshot = await db.collection('cercavins').get();
    let celler = "Vins disponibles:\n";
    
    snapshot.forEach(doc => {
      const d = doc.data();
      celler += `- ${d.nom || 'Vi'} de la DO ${d.do || 'desconeguda'}. Preu: ${d.preu_min}€\n`;
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
          { 
            role: "system", 
            content: `Ets el sommelier d'en Pere Badia. Coneixes aquests vins:\n${celler}\nRespon sempre en català.` 
          },
          { role: "user", content: pregunta }
        ]
      })
    });

    const data = await response.json();

    // Enviem la resposta amb el format que espera Vercel
    if (data.choices && data.choices[0]) {
      res.status(200).json({ resposta: data.choices[0].message.content });
    } else {
      throw new Error("Error en la IA");
    }

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
