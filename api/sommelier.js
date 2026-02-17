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

  // Vins de rescat per si Firebase triga massa o falla
  const rescat = [
    { nom: "Pazo de Barrantes", imatge: "https://www.vilaviniteca.es/media/catalog/product/p/a/pazo_barrantes_21.jpg" },
    { nom: "Cune Reserva", imatge: "https://www.vilaviniteca.es/media/catalog/product/c/u/cune_reserva_19.jpg" },
    { nom: "Martín Códax", imatge: "https://www.vilaviniteca.es/media/catalog/product/m/a/martin_codax_23.jpg" }
  ];

  try {
    const { pregunta, idioma } = req.body;
    const p = (pregunta || "").toLowerCase();
    const idiomaReal = (idioma || 'ca').toLowerCase().includes('es') ? 'CASTELLANO' : 'CATALÀ';

    // 1. Cerca ràpida a Firebase
    const snap = await db.collection('cercavins').limit(80).get();
    const llistaVins = snap.docs.map(doc => ({
      nom: doc.data().nom,
      imatge: doc.data().imatge,
      info: `${doc.data().nom} ${doc.data().do} ${doc.data().tipus}`.toLowerCase()
    })).filter(v => v.imatge && v.imatge.startsWith('http') && !v.imatge.includes('viniteca_logo'));

    // Si Firebase és buit, usem rescat
    const candidats = llistaVins.length > 0 ? llistaVins.slice(0, 20) : rescat;

    // 2. Crida a Groq
    const promptSystem = `Ets un Sommelier expert. Respon en ${idiomaReal}. 
    Escriu 250 paraules usant <span class="nom-vi-destacat">NOM DEL VI</span>. 
    Tria exactament 3 vins del JSON i retorna AQUEST FORMAT:
    {"explicacio": "...", "vins": [{"nom": "...", "imatge": "..."}]}`;

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY?.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        response_format: { type: "json_object" },
        messages: [{ role: 'system', content: promptSystem }, { role: 'user', content: p + " Vins: " + JSON.stringify(candidats) }],
        temperature: 0.3
      })
    });

    const data = await groqResponse.json();
    const contingut = JSON.parse(data.choices[0].message.content);
    
    // 3. Validació de vins triats
    let triats = (contingut.vins || []).slice(0, 3);
    if (triats.length === 0) triats = rescat;

    // Assegurem que les imatges existeixen (si no, posem rescat)
    const respostaFinalVins = triats.map(v => {
      const real = llistaVins.find(l => l.nom === v.nom);
      return { nom: v.nom, imatge: real ? real.imatge : rescat[0].imatge };
    });

    res.status(200).json({ 
      resposta: `${contingut.explicacio} ||| ${JSON.stringify(respostaFinalVins)}` 
    });

  } catch (error) {
    // Si tot falla (Firebase, Groq o el JSON), enviem una resposta que no petarà al frontend
    res.status(200).json({ 
      resposta: `Com a sommelier, us proposo una selecció ideal per a la vostra consulta. ||| ${JSON.stringify(rescat)}` 
    });
  }
};
