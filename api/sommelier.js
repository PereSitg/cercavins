const admin = require('firebase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta, idioma } = req.body;

    let llenguaResposta = "CATALÀ";
    let termeUva = "raïm"; 
    
    if (idioma) {
        if (idioma.startsWith('es')) {
            llenguaResposta = "CASTELLÀ (ESPAÑOL)";
            termeUva = "uva";
        } else if (idioma.startsWith('fr')) {
            llenguaResposta = "FRANCÈS (FRANÇAIS)";
            termeUva = "raisin";
        } else if (idioma.startsWith('en')) {
            llenguaResposta = "ANGLÈS (ENGLISH)";
            termeUva = "grape";
        }
    }

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
    const snapshot = await db.collection('cercavins').limit(40).get(); 
    let celler = [];
    
    snapshot.forEach(doc => { 
      const d = doc.data();
      celler.push({
        nom: d.nom,
        do: d.do,
        imatge: d.imatge, 
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
        model: 'llama-3.1-8b-instant', 
        messages: [
          { 
            role: 'system', 
            content: `Ets el sommelier expert de Cercavins. 
            IMPORTANT: Respon SEMPRE en ${llenguaResposta}.
            
            INSTRUCCIÓ OBLIGATÒRIA:
            1. Recomana 3 o 4 vins del celler.
            2. Explica la varietat de ${termeUva} de cada un.
            3. Al final de tot el text, afegeix SEMPRE el separador "|||" seguit del JSON dels vins triats (nom, do, imatge).
            
            Exemple de format:
            Text de la recomanació...
            |||
            [{"nom": "Vi 1", "do": "DO", "imatge": "url"}]`
          },
          { role: 'user', content: `Celler: ${JSON.stringify(celler)}. Pregunta: ${pregunta}` }
        ],
        temperature: 0.3 // Baixem la temperatura perquè sigui més obedient amb el format
      })
    });

    const data = await response.json();
    
    if (data.choices && data.choices[0]) {
        res.status(200).json({ resposta: data.choices[0].message.content });
    } else {
        throw new Error("Resposta buida");
    }

  } catch (error) {
    res.status(500).json({ resposta: "Error de connexió. ||| []" });
  }
};
