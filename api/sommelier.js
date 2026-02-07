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

    // 1. DETERMINACIÓ DE L'IDIOMA (Català, Castellà, Anglès, Francès)
    const langMap = { 
      'ca': 'CATALÀ', 
      'es': 'CASTELLANO', 
      'en': 'ENGLISH', 
      'fr': 'FRANÇAIS' 
    };
    const codiIdioma = (idioma || 'ca').toLowerCase().slice(0, 2);
    const idiomaReal = langMap[codiIdioma] || 'CATALÀ';

    // 2. RECUPERACIÓ DE VINS AMB VARIETAT (Randomize)
    // Busquem una mostra gran per poder barrejar
    const [econSnapshot, premSnapshot] = await Promise.all([
      db.collection('cercavins').where('preu', '>=', 7).where('preu', '<=', 20).limit(40).get(),
      db.collection('cercavins').where('preu', '>', 20).limit(40).get()
    ]);

    const barrejar = (array) => array.sort(() => Math.random() - 0.5);

    let totsEcon = [];
    econSnapshot.forEach(doc => {
      const d = doc.data();
      totsEcon.push({ nom: d.nom, do: d.do || "DO", preu: d.preu, imatge: d.imatge, categoria: "ECONÒMICA" });
    });

    let totsPrem = [];
    premSnapshot.forEach(doc => {
      const d = doc.data();
      totsPrem.push({ nom: d.nom, do: d.do || "DO", preu: d.preu, imatge: d.imatge, categoria: "PREMIUM" });
    });

    // Triem 10 aleatoris de cada grup per enviar a la IA
    const grupEconòmic = barrejar(totsEcon).slice(0, 10);
    const grupPremium = barrejar(totsPrem).slice(0, 10);

    // 3. CRIDA A GROQ
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
          {
            role: 'system',
            content: `IMPORTANT: MUST RESPOND ENTIRELY IN ${idiomaReal}.
            Ets un sommelier expert i apassionat.
            
            REGLA DE SELECCIÓ (Molt important):
            - Tria exactament 3 vins dels que t'envio.
            - Els 2 primers han de ser de la categoria PREMIUM.
            - El 3er ha de ser de la categoria ECONÒMICA (presenta'l com una gran oportunitat).
            
            ESTIL DE RESPOSTA:
            - Per a CADA VI, escriu un paràgraf extens i detallat explicant el maridatge i notes de tast.
            - Usa <span class="nom-vi-destacat"> pel nom de cada vi.
            - No posis preus numèrics.
            
            JSON: {"explicacio": "text detallat en ${idiomaReal}", "vins_triats": [{"nom": "...", "imatge": "..."}]}`
          },
          {
            role: 'user',
            content: `Pregunta: ${pregunta}. Premium: ${JSON.stringify(grupPremium)}. Econòmics: ${JSON.stringify(grupEconòmic)}.`
          }
        ],
        temperature: 0.8 // Una mica més de creativitat per evitar repeticions
      })
    });

    const data = await groqResponse.json();
    if (!data.choices || !data.choices[0]) throw new Error("IA Error");

    const contingut = JSON.parse(data.choices[0].message.content);
    res.status(200).json({ resposta: `${contingut.explicacio} ||| ${JSON.stringify(contingut.vins_triats)}` });

  } catch (error) {
    res.status(200).json({ resposta: `Error: ${error.message} ||| []` });
  }
};
