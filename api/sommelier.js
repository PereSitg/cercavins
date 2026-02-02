const admin = require('firebase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta, idioma } = req.body;
    let llengua = "CATALÀ";
    if (idioma?.startsWith('es')) llengua = "CASTELLÀ";
    else if (idioma?.startsWith('fr')) llengua = "FRANCÈS";
    else if (idioma?.startsWith('en')) llengua = "ANGLÈS";

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
    const snapshot = await db.collection('cercavins').limit(15).get(); 
    let celler = [];
    snapshot.forEach(doc => { 
      const d = doc.data();
      celler.push({ nom: d.nom, do: d.do, imatge: d.imatge });
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
            - Respon en ${llengua}. 
            - Per cada vi, IDENTIFICA EL RAÏM (ex: Xarel·lo, Pinot Noir) usant el que saps de cada marca.
            - Explica el maridatge basant-te en les característiques del raïm.
            - Format net, sense asteriscs. Separa amb ||| i el JSON.`
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
