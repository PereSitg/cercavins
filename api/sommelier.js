const admin = require('firebase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta, idioma } = req.body;

    // 1. Configuració d'idioma simplificada
    const langMap = {
      'ca': { res: 'CATALÀ', uva: 'raïm' },
      'es': { res: 'CASTELLÀ (ESPAÑOL)', uva: 'uva' },
      'en': { res: 'ANGLÈS (ENGLISH)', uva: 'grape' },
      'fr': { res: 'FRANCÈS (FRANÇAIS)', uva: 'raisin' }
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
    let celler = [];

    // 2. Cerca ultra-directa per paraula clau (ex: "Cune" o "Capellanes")
    const paraules = pregunta.split(' ').filter(p => p.length > 3);
    if (paraules.length > 0) {
        const keyword = paraules[0].charAt(0).toUpperCase() + paraules[0].slice(1).toLowerCase();
        const snap = await db.collection('cercavins')
            .where('nom', '>=', keyword)
            .where('nom', '<=', keyword + '\uf8ff')
            .limit(10).get();
        snap.forEach(doc => celler.push(doc.data()));
    }

    // Si no hi ha resultats específics, portem un pool fix de seguretat
    if (celler.length === 0) {
        const snapGen = await db.collection('cercavins').limit(20).get();
        snapGen.forEach(doc => celler.push(doc.data()));
    }

    // 3. Prompt de "Xoc": Instruccions seques per evitar bucles
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
            content: `Ets el sommelier de Cercavins.
            - Respon en ${config.res}.
            - NOMÉS recomana vins de la llista JSON.
            - Si el vi demanat no hi és, digues: "No el tenim en estoc ara mateix" i recomana 2 alternatives de la llista.
            - PROHIBIT REPETIR FRASES. Sigues breu.
            - FORMAT: [Text Recomanació]|||[JSON Array]`
          },
          { role: 'user', content: `VINS: ${JSON.stringify(celler)}. PREGUNTA: ${pregunta}` }
        ],
        temperature: 0, // Bloqueja la "bogeria" i les repeticions
        max_tokens: 500
      })
    });

    const data = await response.json();
    let finalContent = data.choices[0].message.content;

    // Neteja extra per si la IA encara vol escriure després del JSON
    if (finalContent.includes('|||')) {
        const parts = finalContent.split('|||');
        finalContent = parts[0] + '|||' + parts[1];
    }

    res.status(200).json({ resposta: finalContent });

  } catch (error) {
    res.status(500).json({ resposta: "Error tècnic ||| []" });
  }
};
