const admin = require('firebase-admin');

// Inicialitzem la variable db fora per a un millor rendiment
let db;

module.exports = async (req, res) => {
  // 1. Seguretat: Només acceptem peticions POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Mètode no permès' });
  }

  try {
    const rawKey = process.env.FIREBASE_SERVICE_ACCOUNT ? process.env.FIREBASE_SERVICE_ACCOUNT.trim() : "";

    // VALIDACIÓ CRÍTICA: Si la clau comença per "Error", aturem abans de petar
    if (rawKey.startsWith("Error")) {
      return res.status(200).json({ 
        resposta: "Atenció: La variable de Vercel encara conté un missatge d'error. Si us plau, torna a enganxar el JSON de Firebase a Settings." 
      });
    }

    // 2. Inicialització robusta de Firebase
    if (!admin.apps.length) {
      const serviceAccount = JSON.parse(rawKey.replace(/\\n/g, '\n'));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }
    
    // Assignem la base de dades cada vegada per evitar l'error de 'undefined'
    db = admin.firestore();

    const { pregunta } = req.body;
    if (!pregunta) {
      return res.status(400).json({ resposta: "Falta la pregunta." });
    }

    // 3. Consulta a la teva col·lecció 'cercavins'
    const snapshot = await db.collection('cercavins').get();
    let celler = 'Vins disponibles:\n';
    
    snapshot.forEach(doc => {
      const d = doc.data();
      // Usem els camps reals que hem vist a la teva consola: nom, do i preu
      celler += `- ${d.nom} de la DO ${d.do}. Preu: ${d.preu}\n`;
    });

    // 4. Crida a l'API de Groq
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
            content: `Ets el sommelier d'en Pere. Respon en català i sigues amable. Aquí tens la llista de vins: ${celler}` 
          },
          { role: 'user', content: pregunta }
        ]
      })
    });

    const data = await response.json();
    
    // 5. Enviem la resposta neta a la web (l'index.html espera 'resposta')
    const textIA = data.choices?.[0]?.message?.content || "No tinc resposta ara mateix.";
    
    res.status(200).json({ resposta: textIA });

  } catch (error) {
    // Si hi ha un error de JSON o de xarxa, el veuràs clarament al xat
    console.error("Error detallat:", error.message);
    res.status(500).json({ resposta: "Error de configuració: " + error.message });
  }
};
