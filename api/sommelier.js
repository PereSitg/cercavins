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
    
    // 3. Estratègia de cerca: Portem un bloc de vins i deixem que la IA (la bona) trii
    // Demà amb el model 70b, podrà analitzar 50 vins sense despentinar-se
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

    // 4. Crida a la API (Demà canvia el model a 'llama-3.1-70b-versatile' si el tens actiu)
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY?.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-70b-versatile', // <--- CANVIA AIXÒ DEMÀ SI VOLS LA MAXIMA QUALITAT
        messages: [
          { 
            role: 'system', 
            content: `Ets el sommelier expert de Cercavins.
            - Respon en ${config.res}.
            - Recomana 3 vins del catàleg proporcionat que millor s'ajustin a la pregunta.
            - Per cada vi explica: Nom, D.O., varietat de ${config.uva} i maridatge.
            - És CRÍTIC que el format final sigui: [Text de la recomanació]|||[JSON Array amb els objectes seleccionats].
            - No inventis vins que no estiguin al llistat.`
          },
          { role: 'user', content: `Catàleg: ${JSON.stringify(celler)}. Pregunta: ${pregunta}` }
        ],
        temperature: 0.2
      })
    });

    const data = await response.json();
    res.status(200).json({ resposta: data.choices[0].message.content });

  } catch (error) {
    res.status(500).json({ resposta: "Error de connexió ||| []" });
  }
};
