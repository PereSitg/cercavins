const admin = require('firebase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta, idioma } = req.body;
    
    // Simplifiquem la lògica d'idioma per ser més ràpids
    let llengua = "CATALÀ";
    if (idioma?.toLowerCase().startsWith('es')) llengua = "CASTELLÀ";
    else if (idioma?.toLowerCase().startsWith('fr')) llengua = "FRANCÈS";
    else if (idioma?.toLowerCase().startsWith('en')) llengua = "ANGLÈS";

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
    // Reduïm a 12 vins: és el número màgic per no tenir timeout i tenir varietat
    const snapshot = await db.collection('cercavins').limit(12).get(); 
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
            content: `Ets el sommelier expert de Cercavins. 
            - Respon SEMPRE en ${llengua}. 
            - Per a cada vi recomanat, IDENTIFICA EL SEU RAÏM (varietat) usant la teva memòria (ex: Chardonnay, Garnatxa, Xarel·lo). 
            - Explica breument el maridatge basat en el raïm.
            - No diguis que no tens dades. Sigues un expert.
            - Format: Text net sense asteriscs + ||| + JSON (nom, do, imatge).`
          },
          { role: 'user', content: `Celler: ${JSON.stringify(celler)}. Pregunta: ${pregunta}` }
        ],
        temperature: 0.5,
        max_tokens: 700 // Limitem tokens per accelerar la resposta i evitar el tall de Vercel
      })
    });

    const data = await response.json();
    
    if (data.choices && data.choices[0]) {
        res.status(200).json({ resposta: data.choices[0].message.content });
    } else {
        throw new Error("Resposta de la IA buida o timeout.");
    }

  } catch (error) {
    // Si hi ha error, ho enviem clarament al front
    res.status(500).json({ resposta: "Error de connexió o timeout: " + error.message });
  }
};
