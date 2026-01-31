const admin = require('firebase-admin');

// Inicialitzem la variable de la base de dades fora per reutilitzar-la
let db;

if (!admin.apps.length) {
  try {
    // NETEJA DE LA CLAU: Crucial per evitar l'error "Unexpected token"
    const serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT.replace(/\\n/g, '\n')
    );

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });

    db = admin.firestore();
    console.log('🔥 Firestore inicialitzat correctament!');
  } catch (error) {
    console.error('❌ Error inicialitzant Firebase:', error.message);
  }
} else {
  db = admin.firestore();
}

module.exports = async (req, res) => {
  // Només acceptem preguntes per POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Mètode no permès' });
  }

  try {
    const { pregunta } = req.body;
    if (!pregunta) {
      return res.status(400).json({ error: 'Falta la pregunta' });
    }

    // 1. Llegim els teus vins reals de la col·lecció 'cercavins'
    const snapshot = await db.collection('cercavins').get();
    let celler = 'Llista de vins disponibles:\n';
    
    snapshot.forEach(doc => {
      const d = doc.data();
      // Agafem els camps 'nom', 'do' i 'preu' que hem vist a la teva consola
      celler += `- ${d.nom || 'Vi'} de la DO ${d.do || 'No indicada'}. Preu: ${d.preu || 'Consultar'}\n`;
    });

    // 2. Cridem a Groq amb el format correcte
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
            content: `Ets el sommelier d'en Pere Badia. Sigues amable i respon sempre en català. Utilitza aquesta llista de vins reals per respondre:\n${celler}`
          },
          { role: 'user', content: pregunta }
        ]
      })
    });

    const data = await response.json();

    // 3. Enviem la resposta a la teva web (index.html espera el camp 'resposta')
    const textFinal = data.choices?.[0]?.message?.content || "Ho sento, no he pogut generar una resposta.";
    
    console.log('✅ Resposta enviada al client');
    res.status(200).json({ resposta: textFinal });

  } catch (error) {
    console.error('❌ Error a la funció sommelier:', error.message);
    res.status(500).json({ error: 'Error intern: ' + error.message });
  }
};
