const admin = require('firebase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta, idioma } = req.body;
    const p = (pregunta || "").toLowerCase();

    const langMap = { 'ca': 'CATALÀ', 'es': 'CASTELLANO', 'en': 'ENGLISH', 'fr': 'FRANÇAIS' };
    const idiomaRes = langMap[idioma?.slice(0,2)] || 'CATALÀ';

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
      });
    }
    
    const db = admin.firestore();
    
    // 1. SOLUCIÓ AL PROBLEMA DEL FILTRE: 
    // En lloc de filtrar per base de dades (que demana índexs), 
    // agafem una mostra i deixem que la IA trii. Això NO falla mai.
    const snapshot = await db.collection('cercavins').limit(40).get();
    
    let celler = [];
    snapshot.forEach(doc => {
        const d = doc.data();
        if (d.nom && d.imatge) {
          celler.push({ n: d.nom.toLowerCase(), i: d.imatge, t: d.tipus || "" });
        }
    });

    // 2. DIAGNÒSTIC REAL: Si Firebase realment no respon, ens ho dirà l'error del catch
    if (celler.length === 0) {
      throw new Error("La col·lecció 'cercavins' sembla buida a Firebase.");
    }

    // 3. CRIDA A LA IA
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY?.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192', 
        messages: [
          { 
            role: 'system', 
            content: `Ets un sommelier. Respon en ${idiomaRes}. 
            NORMES:
            1. SEMPRE EN MINÚSCULES.
            2. Noms de vins així: <span class="nom-vi-destacat">nom</span>.
            3. Tria els 3 millors vins del catàleg que maridin amb la pregunta.
            4. FORMAT: Text explicatiu ||| [{"nom":"...","imatge":"..."}]`
          },
          { role: 'user', content: `Celler: ${JSON.stringify(celler)}. Pregunta: ${pregunta}` }
        ],
        temperature: 0.2
      })
    });

    const data = await response.json();
    
    if (!data.choices) {
      throw new Error("Groq no ha donat una resposta vàlida.");
    }

    const respostaIA = data.choices[0].message.content;

    res.status(200).json({ 
      resposta: respostaIA.includes('|||') ? respostaIA : `${respostaIA} ||| []` 
    });

  } catch (error) {
    // Aquest missatge ens dirà la VERITAT si falla
    console.error("DETALL ERROR:", error.message);
    res.status(200).json({ 
      resposta: `sentint-ho molt, hi ha un problema tècnic: ${error.message}. ||| []` 
    });
  }
};
