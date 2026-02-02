const admin = require('firebase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta } = req.body;

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n').trim(),
        }),
      });
    }
    
    const db = admin.firestore();
    // Agafem 20 vins per tenir varietat sense saturar
    const snapshot = await db.collection('cercavins').limit(20).get(); 
    let celler = [];
    
    snapshot.forEach(doc => { 
      const d = doc.data();
      celler.push({
        nom: d.nom,
        do: d.do,
        imatge: d.imatge, // El camp de la teva foto
        tipus: d.tipus
      });
    });

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY?.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile', 
        messages: [
          { 
            role: 'system', 
            content: `Ets el sommelier de Cercavins. 
            NORMES:
            1. Respon EN CATALÀ de forma amable.
            2. NO MENCIONIS EL PREU.
            3. Recomana 3 o 4 vins que encaixin amb la pregunta.
            4. Molt important: Al final de tot, afegeix la cadena "|||" i després un JSON amb els objectes dels vins recomanats (nom, do, imatge).`
          },
          { role: 'user', content: `Vins: ${JSON.stringify(celler)}. Pregunta: ${pregunta}` }
        ]
      })
    });

    const data = await response.json();
    res.status(200).json({ resposta: data.choices[0].message.content });

  } catch (error) {
    res.status(500).json({ resposta: "ERROR: " + error.message });
  }
};
