const admin = require('firebase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta, idioma } = req.body;

    // 1. GESTIÓ D'IDIOMES
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

    // 2. INICIALITZACIÓ FIREBASE
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

    // 3. CONSULTA A GROQ (Model 8B per a proves, més quota disponible)
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
            NORMES DE RESPOSTA:
            1. Respon exclusivament en ${llenguaResposta}.
            2. Si l'idioma és ${llenguaResposta}, no usis MAI paraules en altres idiomes.
            3. Sigues elegant. Recomana 3 o 4 vins del celler proporcionat.
            4. Per cada vi, explica la varietat de ${termeUva} i per què és ideal.
            5. PROHIBIT MENCIONAR PREUS.
            6. Estructura: Text de la recomanació + "|||" + JSON formatat amb [ {nom, do, imatge} ].`
          },
          { role: 'user', content: `Celler disponible: ${JSON.stringify(celler)}. Pregunta: ${pregunta}` }
        ],
        temperature: 0.7
      })
    });

    const data = await response.json();
    
    if (data.error) {
        // Si Groq ens dona error de quota o similar
        return res.status(data.error.code === 'rate_limit_exceeded' ? 429 : 500).json({ 
            resposta: `Error de la IA: ${data.error.message}` 
        });
    }

    if (data.choices && data.choices[0]) {
        res.status(200).json({ resposta: data.choices[0].message.content });
    } else {
        throw new Error("Resposta buida de la IA");
    }

  } catch (error) {
    console.error("Sommelier Error:", error);
    res.status(500).json({ resposta: "Ho sento, el sommelier està descansant. Torna a provar-ho en un moment. ||| []" });
  }
};
