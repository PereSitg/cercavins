const admin = require('firebase-admin');

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

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta, idioma } = req.body;

    // 1. GESTIÓ D'IDIOMA (Ara detectant que estàs en Castellà)
    const langMap = { 'ca': 'CATALÀ', 'es': 'CASTELLANO', 'en': 'ENGLISH', 'fr': 'FRANÇAIS' };
    const codi = (idioma || 'ca').toLowerCase().slice(0, 2);
    const idiomaReal = langMap[codi] || 'CATALÀ';

    // 2. SELECCIÓ DE VINS MÉS INTEL·LIGENT
    // Agafem una mostra més gran per assegurar que hi hagi varietat de colors
    const [premSnap, econSnap] = await Promise.all([
      db.collection('cercavins').where('preu', '>', 30).limit(50).get(),
      db.collection('cercavins').where('preu', '>=', 7).where('preu', '<=', 18).limit(50).get()
    ]);

    const shuffle = (array) => array.sort(() => Math.random() - 0.5);

    const processarSnap = (snap) => {
      let llista = [];
      snap.forEach(doc => {
        const d = doc.data();
        // Incloem el nom de la DO i el color si el tenim per ajudar la IA
        llista.push({ nom: d.nom, do: d.do || "", imatge: d.imatge, preu: d.preu });
      });
      return shuffle(llista).slice(0, 15);
    };

    const seleccioPremium = processarSnap(premSnap);
    const seleccioEcon = processarSnap(econSnap);

    // 3. PROMPT DE SOMMELIER PROFESSIONAL
    const promptSystem = `Eres un Sumiller de prestigio internacional. 
    INSTRUCCIÓN DE IDIOMA: Responde obligatoriamente en ${idiomaReal}.
    
    TU MISIÓN:
    1. Analiza la pregunta del usuario. Si pide marisco o pescado, elige vinos BLANCOS o ESPUMOSOS de las listas. Si pide carne, elige TINTOS.
    2. Selecciona exactamente 3 vinos del contexto proporcionado:
       - Los 2 primeros de la lista ALTA_GAMA.
       - El 3º de la lista OPCIÓN_ECONÓMICA.
    3. Para cada vino, escribe un párrafo extenso (mínimo 6 líneas) explicando el carácter del vino, su zona y por qué el maridaje es perfecto.
    4. Usa un tono culto, apasionado y experto.
    5. Formato: Usa <span class="nom-vi-destacat"> para el nombre de cada vino.`;

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY?.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        response_format: { type: "json_object" },
        messages: [
          { role: 'system', content: promptSystem },
          { 
            role: 'user', 
            content: `RESPONDE EN ${idiomaReal}. Pregunta: ${pregunta}. 
            ALTA_GAMA: ${JSON.stringify(seleccioPremium)}. 
            OPCIÓN_ECONÓMICA: ${JSON.stringify(seleccioEcon)}.` 
          }
        ],
        temperature: 0.6 // Temperatura moderada per mantenir el control del maridatge
      })
    });

    const data = await groqResponse.json();
    const contingut = JSON.parse(data.choices[0].message.content);
    
    const explicacio = contingut.explicacio || contingut.explicación || contingut.explanation;
    const vins = contingut.vins_triats || contingut.vins || contingut.wines;

    res.status(200).json({ resposta: `${explicacio} ||| ${JSON.stringify(vins)}` });

  } catch (error) {
    res.status(200).json({ resposta: `Error: ${error.message} ||| []` });
  }
};
