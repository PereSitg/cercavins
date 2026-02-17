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
    const p = (pregunta || "").toLowerCase();
    const langMap = { 'ca': 'CATALÀ', 'es': 'CASTELLANO', 'en': 'ENGLISH', 'fr': 'FRANÇAIS' };
    const idiomaReal = langMap[(idioma || 'ca').toLowerCase().slice(0, 2)] || 'CATALÀ';

    const paraules = p.split(/[ ,.!?]+/).filter(w => w.length > 2);

    // 1. RECUPERACIÓ OPTIMITZADA
    // Pugem a 300 per tenir més marge, però filtrem amb intel·ligència
    const snapshot = await db.collection('cercavins').limit(300).get();
    
    const totsElsVins = snapshot.docs.map(doc => ({
      ...doc.data(),
      cerca: `${doc.data().nom} ${doc.data().do} ${doc.data().varietat} ${doc.data().tipus}`.toLowerCase()
    })).filter(v => v.imatge && v.imatge.startsWith('http') && !v.imatge.includes('viniteca_logo'));

    // 2. FILTRATGE DE PRIORITAT (El motor del sommelier)
    let vinsSeleccionats = totsElsVins.sort((a, b) => {
      // Prioritat 1: El vi que l'usuari ha escrit exactament
      const aNomMatch = paraules.some(pal => a.nom.toLowerCase().includes(pal));
      const bNomMatch = paraules.some(pal => b.nom.toLowerCase().includes(pal));
      if (aNomMatch && !bNomMatch) return -1;
      if (!aNomMatch && bNomMatch) return 1;

      // Prioritat 2: Maridatge segons el tipus de plat
      const esPeix = p.includes('percebe') || p.includes('marisc') || p.includes('peix') || p.includes('arròs');
      const esCarn = p.includes('carn') || p.includes('fricandó') || p.includes('vedella') || p.includes('conill');
      
      if (esPeix && a.info.includes('blanc') && !b.info.includes('blanc')) return -1;
      if (esCarn && a.info.includes('negre') && !b.info.includes('negre')) return -1;

      return 0;
    }).slice(0, 15);

    // 3. PROMPT DE TRIPLE ACCIÓ
    const promptSystem = `Ets un Sommelier d'elit. Respon en ${idiomaReal}.
    
    TASQUES:
    1. SI PREGUNTEN PER UN VI: Explica'n les notes de tast, la DO i per què és especial.
    2. SI PREGUNTEN PER UN PLAT: Explica breument la tradició del plat (unes línies) i marida'l.
    3. SELECCIÓ: Tria exactament 3 vins de la llista que et passo (prioritza el que hagin demanat si hi és).

    REGLA: Usa <span class="nom-vi-destacat">NOM</span> i <span class="text-destacat-groc">DO</span>.
    FORMAT JSON: {"explicacio": "...", "vins_triats": [{"nom": "...", "imatge": "..."}]}`;

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY?.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        response_format: { type: "json_object" },
        messages: [
          { role: 'system', content: promptSystem },
          { role: 'user', content: `Consulta: ${pregunta}. Llista vins: ${JSON.stringify(vinsSeleccionats)}` }
        ],
        temperature: 0.3
      })
    });

    const data = await groqResponse.json();
    const contingut = JSON.parse(data.choices[0].message.content);
    
    // 4. RECONSTRUCCIÓ DE SEGURETAT (Evita imatges trencades)
    const respostaVins = (contingut.vins_triats || []).map(vIA => {
      // Busquem a la llista gran per si la IA ha escurçat el nom
      const real = totsElsVins.find(r => r.nom.includes(vIA.nom) || vIA.nom.includes(r.nom)) || vinsSeleccionats[0];
      return { nom: real.nom, imatge: real.imatge };
    }).slice(0, 3);

    res.status(200).json({ 
      resposta: `${contingut.explicacio} ||| ${JSON.stringify(respostaVins)}` 
    });

  } catch (error) {
    res.status(200).json({ 
      resposta: "El sommelier està seleccionant la millor copa. Torna-ho a provar! ||| []" 
    });
  }
};
