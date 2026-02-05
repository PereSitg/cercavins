const admin = require('firebase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta, idioma } = req.body;

    const langMap = {
      'ca': { res: 'CATALÀ' },
      'es': { res: 'CASTELLANO' }
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
    
    // 1. OPTIMITZACIÓ: Limitem a 100 vins per evitar que la connexió "peti" per temps
    const snapshot = await db.collection('cercavins').limit(100).get();
    let celler = [];
    snapshot.forEach(doc => {
        const d = doc.data();
        // Enviem el mínim text possible a la IA per guanyar velocitat
        celler.push({ n: d.nom, t: d.tipus, i: d.imatge });
    });

    // 2. MODEL MÉS RÀPID: Usem 'llama3-8b-8192' que és instantani i evita el "Error de connexió"
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
            content: `Ets un sommelier. Respon en ${config.res}.
            NORMES CRÍTIQUES:
            1. No usis MAJÚSCULES.
            2. Noms dels vins SEMPRE així: <span class="nom-vi-destacat">nom del vi</span>.
            3. Tria exactament 3 vins del catàleg.
            4. FORMAT: Text ||| [{"nom":"...","imatge":"..."}]`
          },
          { 
            role: 'user', 
            content: `Celler: ${JSON.stringify(celler)}. Pregunta: ${pregunta}` 
          }
        ],
        temperature: 0.2
      })
    });

    if (!response.ok) throw new Error('Error Groq');

    const data = await response.json();
    let respostaIA = data.choices[0].message.content;

    res.status(200).json({ 
      resposta: respostaIA.includes('|||') ? respostaIA : `${respostaIA} ||| []` 
    });

  } catch (error) {
    console.error(error);
    // Si falla, almenys responem alguna cosa que l'usuari entengui
    res.status(200).json({ resposta: "He tingut un problema en buscar al celler. Pots repetir la pregunta? ||| []" });
  }
};
