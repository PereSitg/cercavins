const admin = require('firebase-admin');

if (!admin.apps.length) {
  try {
    // Aquesta línia és la que neteja el format de la clau de Vercel
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT.trim());
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (error) {
    console.error("Error carregant Firebase:", error.message);
  }
}

const db = admin.firestore();

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Mètode no permès" });

  try {
    const { pregunta } = req.body;
    
    // Fem la consulta a la col·lecció 'cercavins' que veiem a la teva captura
    const snapshot = await db.collection('cercavins').get();
    let celler = "Llista de vins de la base de dades:\n";
    
    snapshot.forEach(doc => {
      const d = doc.data();
      celler += `- ${d.nom} de la DO ${d.do}. Preu: ${d.preu}\n`;
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
          { role: "system", content: `Ets el sommelier d'en Pere Badia. Aquests són els vins reals del celler:\n${celler}\nRespon sempre en català de forma amable.` },
          { role: "user", content: pregunta }
        ]
      })
    });

    const data = await response.json();
    res.status(200).json({ resposta: data.choices[0].message.content });
    
  } catch (error) {
    res.status(500).json({ error: "Error de connexió: " + error.message });
  }
};
