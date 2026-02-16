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
    const p = pregunta.toLowerCase();
    
    const langMap = { 'ca': 'CATALÀ', 'es': 'CASTELLANO', 'en': 'ENGLISH', 'fr': 'FRANÇAIS' };
    const codiClient = (idioma || 'ca').toLowerCase().slice(0, 2);
    const idiomaReal = langMap[codiClient] || 'CATALÀ';

    // 1. Cercar 100 vins per tenir varietat
    const [premSnap, econSnap] = await Promise.all([
      db.collection('cercavins').where('preu', '>', 35).limit(100).get(),
      db.collection('cercavins').where('preu', '>=', 7).where('preu', '<=', 18).limit(100).get()
    ]);

    // 2. Processar i crear un mapa de referència (ID -> Dades)
    const mapaVins = {};
    const processarVins = (snap) => {
      return snap.docs
        .map(doc => {
          const d = doc.data();
          const id = doc.id;
          const vi = {
            id: id,
            nom: d.nom,
            do: d.do || "DO",
            imatge: d.imatge || "",
            desc: `${d.nom} ${d.do} ${d.tipus || ''} ${d.varietat || ''}`.toLowerCase()
          };
          if (vi.imatge && vi.imatge.startsWith('http') && vi.do !== "Vila Viniteca") {
             mapaVins[id] = vi; // Guardem al mapa per recuperar-lo després
             return vi;
          }
          return null;
        })
        .filter(v => v !== null)
        .sort(() => Math.random() - 0.5)
        .slice(0, 15);
    };

    const llistaAlta = processarVins(premSnap);
    const llistaEcon = processarVins(econSnap);

    // 3. Prompt: Només enviem ID, NOM i DO a la IA (no la URL, per no confondre-la)
    const llistaPerIA = [...llistaAlta, ...llistaEcon].map(v => ({ id: v.id, nom: v.nom, do: v.do }));

    const promptSystem = `Ets un Sommelier d'elit. Respon en ${idiomaReal}.
    OBJECTIU: Escriu una recomanació MAGISTRAL d'unes 300 paraules. 
    FORMAT: Vi en <span class="nom-vi-destacat"> i DO en <span class="text-destacat-groc">.
    
    Tria 3 vins del llistat. És OBLIGATORI que retornis l'ID del vi que has triat.
    
    VINS: ${JSON.stringify(llistaPerIA)}

    JSON OBLIGATORI: {"explicacio": "...", "ids_triats": ["id1", "id2", "id3"]}`;

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY?.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant', 
        response_format: { type: "json_object" },
        messages: [ { role: 'system', content: promptSystem }, { role: 'user', content: pregunta } ],
        temperature: 0.6
      })
    });

    const data = await groqResponse.json();
    const contingut = JSON.parse(data.choices[0].message.content);
    
    // 4. RECUPERACIÓ REAL DE LES IMATGES (Aquí està la clau)
    // Busquem al nostre mapa els IDs que la IA ha triat
    const vinsFinals = (contingut.ids_triats || []).map(id => {
       const v = mapaVins[id];
       return v ? { nom: v.nom, imatge: v.imatge } : null;
    }).filter(v => v !== null);

    res.status(200).json({ 
      resposta: `${contingut.explicacio} ||| ${JSON.stringify(vinsFinals)}` 
    });

  } catch (error) {
    res.status(200).json({ resposta: `Error en el servei. ||| []` });
  }
};
