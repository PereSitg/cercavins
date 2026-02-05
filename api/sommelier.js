const admin = require('firebase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta, idioma } = req.body;

    // 1. Configuració d'idioma basada en el dispositiu de l'usuari
    const langMap = {
      'ca': { res: 'CATALÀ', uva: 'raïm' },
      'es': { res: 'CASTELLANO', uva: 'uva' },
      'en': { res: 'ENGLISH', uva: 'grape' },
      'fr': { res: 'FRANÇAIS', uva: 'raisin' }
    };
    const config = langMap[idioma?.slice(0,2)] || langMap['ca'];

    // 2. Inicialització de Firebase
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
    
    // 3. OBTENCIÓ TOTAL: Llegeix TOT el catàleg sense restriccions
    const snapshot = await db.collection('cercavins').get();
    let celler = [];
    snapshot.forEach(doc => {
        const d = doc.data();
        celler.push({
            nom: d.nom,
            do: d.do,
            imatge: d.imatge,
            tipus: d.tipus,
            raim: d.raim || "Cupatge tradicional"
        });
    });

    // 4. Crida a la API Groq (Llama 3.3 70b)
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
            content: `Eres un Sommelier Técnico experto. Tu tono es profesional y analítico.

            INSTRUCCIONES DE FORMATO:
            1. Responde siempre en el idioma solicitado: ${config.res}.
            2. NOMBRES DE VINOS: Siempre en MAYÚSCULAS y dentro de <span class="nom-vi-destacat">NOMBRE DEL VINO</span>.
            3. PROHIBIDO: No uses asteriscos (**), ni negritas, ni listas. Usa exclusivamente texto narrativo.
            4. EXPLICACIÓN: Argumenta técnicamente por qué el vino elegido (acidez, cuerpo, notas) encaja con la comida.
            
            ESTRUCTURA DE SALIDA:
            [Texto narrativo de la recomendación]
            |||
            [{"nom":"NOMBRE EN MAYÚSCULAS","imatge":"url"}]`
          },
          { 
            role: 'user', 
            content: `Idioma de respuesta: ${config.res}. Catálogo completo: ${JSON.stringify(celler)}. Pregunta: ${pregunta}` 
          }
        ],
        temperature: 0.1 // Precisió màxima per evitar errors de format
      })
    });

    const data = await response.json();
    let respostaIA = data.choices[0].message.content;

    // 5. Neteja de seguretat per al separador i el JSON
    if (respostaIA.includes('|||')) {
        const parts = respostaIA.split('|||');
        const textNet = parts[0].trim();
        let jsonNet = parts[1].trim();
        
        const ultimaClau = jsonNet.lastIndexOf(']');
        if (ultimaClau !== -1) jsonNet = jsonNet.substring(0, ultimaClau + 1);
        
        res.status(200).json({ resposta: `${textNet} ||| ${jsonNet}` });
    } else {
        res.status(200).json({ resposta: `${respostaIA} ||| []` });
    }

  } catch (error) {
    res.status(500).json({ resposta: "Error ||| []" });
  }
};
