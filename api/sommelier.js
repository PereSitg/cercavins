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

    // 1. DETERMINACIÓ DE L'IDIOMA
    const langMap = { 'ca': 'CATALÀ', 'es': 'CASTELLANO', 'en': 'ENGLISH', 'fr': 'FRANÇAIS' };
    const codi = (idioma || 'ca').toLowerCase().slice(0, 2);
    const idiomaReal = langMap[codi] || 'CATALÀ';

    // 2. RECUPERACIÓ DE VINS (Diferenciació Alta Gama vs Assequibles)
    const [premSnap, econSnap] = await Promise.all([
      db.collection('cercavins').where('preu', '>', 30).limit(40).get(),
      db.collection('cercavins').where('preu', '>=', 7).where('preu', '<=', 18).limit(40).get()
    ]);

    const shuffle = (array) => array.sort(() => Math.random() - 0.5);

    let vinsPremium = [];
    premSnap.forEach(doc => {
      const d = doc.data();
      vinsPremium.push({ nom: d.nom, do: d.do || "DO", imatge: d.imatge, preu: d.preu });
    });

    let vinsEcon = [];
    econSnap.forEach(doc => {
      const d = doc.data();
      vinsEcon.push({ nom: d.nom, do: d.do || "DO", imatge: d.imatge, preu: d.preu });
    });

    // Barregem i seleccionem una mostra
    const seleccioPremium = shuffle(vinsPremium).slice(0, 12);
    const seleccioEcon = shuffle(vinsEcon).slice(0, 10);

    // 3. CRIDA A GROQ AMB VALIDACIÓ DE SEGURETAT
    const promptSystem = `Eres un Sumiller experto. Responde OBLIGATORIAMENTE en ${idiomaReal}.
    INSTRUCCIONES:
    - Escribe una introducción larga y técnica sobre el maridaje.
    - Elige 2 vinos de ALTA_GAMA y 1 de OPCIÓN_ECONÓMICA.
    - Para cada vi, un párrafo detallado con notas de cata y por qué marida bien.
    - Usa <span class="nom-vi-destacat"> para el nombre de cada vino.
    - Formato JSON estricto: {"explicacio": "...", "vins_triats": [{"nom": "...", "imatge": "..."}]}`;

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
          { role: 'user', content: `Idioma: ${idiomaReal}. Pregunta: ${pregunta}. ALTA_GAMA: ${JSON.stringify(seleccioPremium)}. OPCIÓN_ECONÓMICA: ${JSON.stringify(seleccioEcon)}.` }
        ],
        temperature: 0.7
      })
    });

    const data = await groqResponse.json();

    // --- PROTECCIÓ CONTRA L'ERROR 'UNDEFINED 0' ---
    if (!data || !data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error("Error detallat de Groq:", data);
      throw new Error("La IA no ha pogut processar la resposta en aquest moment.");
    }

    const contingut = JSON.parse(data.choices[0].message.content);
    
    // Assegurem que agafem el text encara que la IA canviï la clau
    const explicacioFinal = contingut.explicacio || contingut.explicación || contingut.explanation || "No s'ha pogut generar el text.";
    const vinsFinals = contingut.vins_triats || contingut.vins || [];

    res.status(200).json({ resposta: `${explicacioFinal} ||| ${JSON.stringify(vinsFinals)}` });

  } catch (error) {
    console.error("Error Sommelier:", error);
    res.status(200).json({ 
      resposta: `Ho sento Pere, el sommelier està tastant vins i ha tingut un petit error: ${error.message} ||| []` 
    });
  }
};
