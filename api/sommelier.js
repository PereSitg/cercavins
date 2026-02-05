const admin = require('firebase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta, idioma } = req.body;

    const langMap = {
      'ca': { res: 'CATALÀ', uva: 'raïm' },
      'es': { res: 'CASTELLANO', uva: 'uva' },
      'en': { res: 'ENGLISH', uva: 'grape' },
      'fr': { res: 'FRANÇAIS', uva: 'raisin' }
    };
    const config = langMap[idioma?.slice(0,2)] || langMap['ca'];

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
    
    // MILLORA: Agafem només els camps imprescindibles per no saturar la memòria
    const snapshot = await db.collection('cercavins').get();
    let celler = [];
    snapshot.forEach(doc => {
        const d = doc.data();
        celler.push({
            n: d.nom,      // Fem servir claus curtes per estalviar espai
            t: d.tipus,
            r: d.raim || "",
            i: d.imatge
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
            content: `Ets un Sommelier Tècnic. Respon en ${config.res}. 
            NORMES: 1. Noms en MAJÚSCULES dins de <span class="nom-vi-destacat">NOM</span>. 
            2. No usis asteriscs (**). 
            3. Analitza el maridatge tècnicament.
            ESTRUCTURA: Text ||| [{"nom":"...","imatge":"..."}]`
          },
          { 
            role: 'user', 
            content: `Catàleg: ${JSON.stringify(celler)}. Pregunta: ${pregunta}` 
          }
        ],
        temperature: 0.1
      })
    });

    if (!response.ok) {
        const errorData = await response.json();
        console.error('Error de Groq:', errorData);
        return res.status(500).json({ resposta: "Error de la IA ||| []" });
    }

    const data = await response.json();
    let respostaIA = data.choices[0].message.content;

    if (respostaIA.includes('|||')) {
        const parts = respostaIA.split('|||');
        res.status(200).json({ resposta: `${parts[0].trim()} ||| ${parts[1].trim()}` });
    } else {
        res.status(200).json({ resposta: `${respostaIA} ||| []` });
    }

  } catch (error) {
    console.error('Error general:', error);
    res.status(500).json({ resposta: "Error de connexió ||| []" });
  }
};
