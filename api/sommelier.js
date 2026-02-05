const admin = require('firebase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta, idioma } = req.body;

    // 1. Configuració d'idioma
    const langMap = {
      'ca': { res: 'CATALÀ', uva: 'raïm' },
      'es': { res: 'CASTELLÀ', uva: 'uva' },
      'en': { res: 'ANGLÈS', uva: 'grape' },
      'fr': { res: 'FRANCÈS', uva: 'raisin' }
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
    
    // 3. Estratègia de cerca
    const snapshot = await db.collection('cercavins').limit(50).get();
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

    // 4. Crida a la API (Llama 3.3 70b)
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
            1. Respon en ${config.res}.
            2. Si demanen recomanació, tria entre 3 i 4 vins. Si pregunten per un vi concret, explica les seves notes i el raïm.
            3. FORMAT DELS NOMS: Escriu el nom de cada vi així: <span class="nom-vi-destacat">NOM DEL VI</span>.
            4. PROHIBIT: No usis asteriscs (**), ni negretes, ni llistes amb guions. Usa text narratiu.
            5. SEPARADOR OBLIGATORI: Acaba el text amb el separador ||| i el JSON Array amb els objectes seleccionats (nom i imatge). No escriguis res després del JSON.`
          },
          { role: 'user', content: `Catàleg: ${JSON.stringify(celler)}. Pregunta: ${pregunta}` }
        ],
        temperature: 0.1
      })
    });

    const data = await response.json();
    let respostaIA = data.choices[0].message.content;

    // Neteja de seguretat per evitar text extra després del JSON
    if (respostaIA.includes('|||')) {
        const parts = respostaIA.split('|||');
        const textNet = parts[0].trim();
        let jsonNet = parts[1].trim();
        const ultimaClau = jsonNet.lastIndexOf(']');
        if (ultimaClau !== -1) jsonNet = jsonNet.substring(0, ultimaClau + 1);
        res.status(200).json({ resposta: `${textNet} ||| ${jsonNet}` });
    } else {
        res.status(200).json({ resposta: respostaIA + " ||| []" });
    }

  } catch (error) {
    res.status(500).json({ resposta: "Error de connexió ||| []" });
  }
};
