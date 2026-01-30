const admin = require('firebase-admin');

// Inicialitzem Firebase només un cop
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const { pregunta } = JSON.parse(event.body);
    
    // LLegim els teus vins
    const snapshot = await db.collection('cercavins').get();
    let celler = "";
    snapshot.forEach(doc => {
      const d = doc.data();
      celler += `- ${d.nom || 'Sense nom'} (${d.raïm || 'Varietat desconeguda'})\n`;
    });

    // Cridem a Groq
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: `Ets el sommelier d'en Pere Badia. El seu celler té:\n${celler}\nRespon sempre en català.` },
          { role: "user", content: pregunta }
        ]
      })
    });

    const data = await response.json();
    return {
      statusCode: 200,
      body: JSON.stringify({ resposta: data.choices[0].message.content })
    };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};