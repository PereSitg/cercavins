const admin = require('firebase-admin');

// Inicialització de Firebase (Arreglant la clau per a Vercel)
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT.replace(/\\n/g, '\n'));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

// Funció principal per a Vercel
module.exports = async (req, res) => {
  // Només acceptem peticions POST des del teu formulari
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Mètode no permès" });
  }

  try {
    const { pregunta } = req.body;

    // 1. Llegim el teu celler de Firebase
    const snapshot = await db.collection('cercavins').get();
    let celler = "Llista de vins disponibles:\n";
    
    snapshot.forEach(doc => {
      const d = doc.data();
      celler += `- ${d.nom || 'Vi'} de la DO ${d.do || 'desconeguda'}. Preu: ${d.preu_min}€\n`;
    });

    // 2. Cridem a la API de Groq amb el model Llama 3
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
            content: `Ets el sommelier d'en Pere Badia. Coneixes aquests vins:\n${celler}\nRespon sempre en català, sigues amable i expert.` 
          },
          { role: "user", content: pregunta }
        ]
      })
    });

    const data = await response.json();

    // 3. Enviem la resposta al teu frontend
    if (data.choices && data.choices[0]) {
      res.status(200).json({ resposta: data.choices[0].message.content });
    } else {
      throw new Error("Error en la resposta de la IA");
    }

  } catch (error) {
    console.error("Error al servidor:", error);
    res.status(500).json({ error: error.message });
  }
};
