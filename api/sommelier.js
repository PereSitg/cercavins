const admin = require('firebase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta, idioma } = req.body;

    // 1. GESTIÓ D'IDIOMES (Ara inclou Anglès)
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
    // Augmentem una mica el límit perquè la IA tingui on triar
    const snapshot = await db.collection('cercavins').limit(40).get(); 
    let celler = [];
    
    snapshot.forEach(doc => { 
      const d = doc.data();
      celler.push({
        nom: d.nom,
        do: d.do,
        imatge: d.imatge, 
        tipus: d.tipus
        // No enviem el preu a la IA per estalviar tokens i complir la teva norma
      });
    });

    // 3. CONSULTA A GROQ (Model 70B)
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
            NORMES DE RESPOSTA:
            1. Respon exclusivament en ${llenguaResposta}.
            2. Si l'idioma és ${llenguaResposta}, no usis MAI paraules en altres idiomes (Exemple: si és anglès, usa "${termeUva}").
            3. Sigues elegant i professional. Recomana 3 o 4 vins del celler proporcionat que millor maridin amb la pregunta.
            4. Per cada vi, explica la varietat de ${termeUva} (usa la teva memòria si no està al JSON) i per què és ideal.
            5. PROHIBIT MENCIONAR PREUS.
            6. Estructura: Text de la recomanació + "|||" + JSON formatat amb [ {nom, do, imatge} ].`
          },
          { role: 'user', content: `Celler disponible: ${JSON.stringify(celler)}. Pregunta de l'usuari: ${pregunta}` }
        ],
        temperature: 0.7 // Un pèl de creativitat per fer-ho més natural
      })
    });

    const data = await response.json();
    
    if (data.choices && data.choices[0]) {
        res.status(200).json({ resposta: data.choices[0].message.content });
    } else {
        throw new Error("Resposta buida de la IA");
    }

  } catch (error) {
    console.error("Sommelier Error:", error);
    res.status(500).json({ resposta: "Ho sento, he tingut un problema amb el celler. Torna a provar-ho en un moment. ||| []" });
  }
};
