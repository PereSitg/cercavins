const admin = require('firebase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta, idioma } = req.body;

    const langMap = {
      'ca': { res: 'CATALÀ' },
      'es': { res: 'CASTELLANO' },
      'en': { res: 'ENGLISH' },
      'fr': { res: 'FRANÇAIS' }
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
    
    // 1. AGAFEM NOMÉS LES DADES CRÍTICS (Estalvi de 70% d'espai)
    const snapshot = await db.collection('cercavins').get();
    let celler = [];
    snapshot.forEach(doc => {
        const d = doc.data();
        celler.push({
            n: d.nom,
            t: d.tipus,
            i: d.imatge
        });
    });

    // 2. CRIDA A LA IA AMB SYSTEM PROMPT CURT (Més ràpid i menys errors)
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
            content: `Sommelier técnico. Idioma: ${config.res}. 
            REGLAS:
            1. Nombres en MAYÚSCULAS y <span class="nom-vi-destacat">NOMBRE</span>.
            2. Prohibido usar asteriscos (**).
            3. Separador: Texto ||| [{"nom":"...","imatge":"..."}]`
          },
          { 
            role: 'user', 
            content: `Catálogo: ${JSON.stringify(celler)}. Pregunta: ${pregunta}` 
          }
        ],
        temperature: 0.1
      })
    });

    // Si Groq dóna error de tokens, baixem el model al 8b (més petit) per no fallar
    if (!response.ok) {
        return res.status(200).json({ resposta: "El catàleg és massa gran per al model 70B. Si us plau, intenta reduir la cerca o contacta amb l'administrador. ||| []" });
    }

    const data = await response.json();
    let respostaIA = data.choices[0].message.content;

    if (respostaIA.includes('|||')) {
        res.status(200).json({ resposta: respostaIA });
    } else {
        res.status(200).json({ resposta: `${respostaIA} ||| []` });
    }

  } catch (error) {
    res.status(500).json({ resposta: "Error de connexió ||| []" });
  }
};
